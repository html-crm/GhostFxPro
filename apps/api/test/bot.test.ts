import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { hashPassword } from "@ghostfx/security";
import { MockProvider } from "@ghostfx/bot";
import type { SqlExecutor } from "../src/db.ts";
import { BotRunner, type Scheduler, type TimerHandle } from "../src/services/bot-runner.ts";
import { makeTestApp, login, authed, type TestApp } from "./helpers.ts";

const NOW = 1_700_000_000_000;

/** A scheduler the test drives by hand — no real timers. */
class ManualScheduler implements Scheduler {
  private tasks: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
  setTimer(fn: () => void, ms: number): TimerHandle {
    const task = { fn, ms, cancelled: false };
    this.tasks.push(task);
    return task;
  }
  clearTimer(handle: TimerHandle): void {
    (handle as { cancelled: boolean }).cancelled = true;
  }
  pending(): number {
    return this.tasks.filter((t) => !t.cancelled).length;
  }
  lastDelay(): number | undefined {
    return this.tasks.at(-1)?.ms;
  }
  fire(): void {
    const task = this.tasks.find((t) => !t.cancelled);
    if (task) {
      task.cancelled = true;
      task.fn();
    }
  }
}

const emptyDb = { query: async () => ({ rows: [] }) } as unknown as SqlExecutor;

async function userWithRole(
  t: TestApp,
  email: string,
  role: "USER" | "ADMIN",
  status = "APPROVED",
): Promise<string> {
  const hash = hashPassword("password123");
  await t.db.query(
    `INSERT INTO users (email, display_name, password_hash, role, status, email_verified)
     VALUES ($1, 'Tester', $2, $3::user_role, $4::user_status, true)`,
    [email, hash, role, status],
  );
  const res = await login(t.app, email, "password123");
  return res.json().token as string;
}

describe("BotRunner lifecycle", () => {
  test("start schedules the first tick one interval out and reports status", () => {
    const sched = new ManualScheduler();
    const runner = new BotRunner({
      db: emptyDb,
      provider: new MockProvider({}),
      intervalMs: 5000,
      now: () => NOW,
      scheduler: sched,
    });
    assert.equal(runner.status().running, false);
    const status = runner.start();
    assert.equal(status.running, true);
    assert.equal(status.scope, "all");
    assert.equal(status.nextTickAt, NOW + 5000);
    assert.equal(sched.pending(), 1);
    assert.equal(sched.lastDelay(), 5000);
    runner.stop();
  });

  test("start is idempotent and does not stack timers", () => {
    const sched = new ManualScheduler();
    const runner = new BotRunner({
      db: emptyDb,
      provider: new MockProvider({}),
      intervalMs: 1000,
      now: () => NOW,
      scheduler: sched,
    });
    runner.start();
    runner.start();
    assert.equal(sched.pending(), 1);
    runner.stop();
  });

  test("a fire runs a tick, updates status, and reschedules", async () => {
    const sched = new ManualScheduler();
    const runner = new BotRunner({
      db: emptyDb,
      provider: new MockProvider({}),
      intervalMs: 1000,
      now: () => NOW,
      scheduler: sched,
    });
    runner.start();
    sched.fire();
    await new Promise((r) => setImmediate(r));
    const status = runner.status();
    assert.equal(status.tickCount, 1);
    assert.equal(status.lastTickAt, NOW);
    assert.deepEqual(status.lastResult, { evaluated: 0, closed: 0, skipped: 0 });
    assert.equal(status.lastError, null);
    assert.equal(sched.pending(), 1, "rescheduled after the tick");
    runner.stop();
  });

  test("stop cancels the pending timer and clears nextTickAt", () => {
    const sched = new ManualScheduler();
    const runner = new BotRunner({
      db: emptyDb,
      provider: new MockProvider({}),
      intervalMs: 1000,
      now: () => NOW,
      scheduler: sched,
    });
    runner.start();
    const status = runner.stop();
    assert.equal(status.running, false);
    assert.equal(status.nextTickAt, null);
    assert.equal(sched.pending(), 0);
  });

  test("single-flight: concurrent ticks execute only once", async () => {
    const sched = new ManualScheduler();
    const runner = new BotRunner({
      db: emptyDb,
      provider: new MockProvider({}),
      intervalMs: 1000,
      now: () => NOW,
      scheduler: sched,
    });
    const [a, b] = await Promise.all([runner.runOnce(), runner.runOnce()]);
    assert.deepEqual(a, b);
    assert.equal(runner.status().tickCount, 1);
  });

  test("a tick failure is recorded and the loop keeps scheduling", async () => {
    const sched = new ManualScheduler();
    const failingDb = {
      query: async () => {
        throw new Error("boom");
      },
    } as unknown as SqlExecutor;
    const runner = new BotRunner({
      db: failingDb,
      provider: new MockProvider({}),
      intervalMs: 1000,
      now: () => NOW,
      scheduler: sched,
    });
    runner.start();
    sched.fire();
    await new Promise((r) => setImmediate(r));
    const status = runner.status();
    assert.equal(status.lastError, "boom");
    assert.equal(status.running, true);
    assert.equal(sched.pending(), 1, "loop continues after a failure");
    runner.stop();
  });

  test("rejects a non-positive interval", () => {
    assert.throws(
      () =>
        new BotRunner({
          db: emptyDb,
          provider: new MockProvider({}),
          intervalMs: 0,
        }),
      /invalid_interval/,
    );
  });
});

describe("bot control routes", () => {
  let t: TestApp;

  before(async () => {
    t = await makeTestApp({ now: () => NOW });
  });
  after(async () => {
    await t.close();
  });

  test("status is visible to an approved trader", async () => {
    const token = await userWithRole(t, "viewer@example.test", "USER");
    const res = await t.app.inject({
      method: "GET",
      url: "/trading/bot/status",
      headers: authed(token),
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().bot.running, false);
    assert.equal(res.json().bot.scope, "all");
  });

  test("status is forbidden to a pending user", async () => {
    const token = await userWithRole(t, "pending-viewer@example.test", "USER", "PENDING");
    const res = await t.app.inject({
      method: "GET",
      url: "/trading/bot/status",
      headers: authed(token),
    });
    assert.equal(res.statusCode, 403);
  });

  test("a plain user cannot start or stop the engine", async () => {
    const token = await userWithRole(t, "user-ctrl@example.test", "USER");
    const start = await t.app.inject({
      method: "POST",
      url: "/trading/bot/start",
      headers: authed(token),
    });
    assert.equal(start.statusCode, 403);
    const stop = await t.app.inject({
      method: "POST",
      url: "/trading/bot/stop",
      headers: authed(token),
    });
    assert.equal(stop.statusCode, 403);
  });

  test("an admin can start and stop the engine", async () => {
    const token = await userWithRole(t, "admin@example.test", "ADMIN");
    const start = await t.app.inject({
      method: "POST",
      url: "/trading/bot/start",
      headers: authed(token),
    });
    assert.equal(start.statusCode, 200);
    assert.equal(start.json().bot.running, true);

    const status = await t.app.inject({
      method: "GET",
      url: "/trading/bot/status",
      headers: authed(token),
    });
    assert.equal(status.json().bot.running, true);

    const stop = await t.app.inject({
      method: "POST",
      url: "/trading/bot/stop",
      headers: authed(token),
    });
    assert.equal(stop.statusCode, 200);
    assert.equal(stop.json().bot.running, false);

    // tidy up any default runner timer
    await t.app.inject({ method: "POST", url: "/trading/bot/stop", headers: authed(token) });
  });
});
