import type { MarketDataProvider } from "@ghostfx/bot";
import type { SqlExecutor } from "../db.ts";
import { runTick, type TickResult } from "./paper.ts";

/** Handle returned by a scheduler; opaque to the runner. */
export type TimerHandle = unknown;

/**
 * Minimal scheduling seam. The default uses `setTimeout`; tests inject a manual
 * scheduler so tick timing is deterministic and no real timers leak.
 */
export interface Scheduler {
  setTimer(fn: () => void, ms: number): TimerHandle;
  clearTimer(handle: TimerHandle): void;
}

const defaultScheduler: Scheduler = {
  setTimer(fn, ms) {
    const handle = setTimeout(fn, ms);
    // Never keep the process alive just for the bot loop.
    (handle as { unref?: () => void }).unref?.();
    return handle;
  },
  clearTimer(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export interface BotRunnerDeps {
  db: SqlExecutor;
  provider: MarketDataProvider;
  /** Interval between ticks. Default 30s. */
  intervalMs?: number;
  /** Injected clock (ms). Defaults to Date.now. */
  now?: () => number;
  /** Scope to a single user's open trades; omit for all users. */
  userId?: string;
  scheduler?: Scheduler;
  /** Called after every finished tick (success or failure) for logging. */
  onTick?: (status: BotStatus) => void;
}

export interface BotStatus {
  running: boolean;
  intervalMs: number;
  scope: "all" | string;
  tickCount: number;
  lastTickAt: number | null;
  nextTickAt: number | null;
  lastResult: TickResult | null;
  lastError: string | null;
  /** True while a tick is currently executing. */
  inFlight: boolean;
}

/**
 * Runs the paper-trading engine on a schedule ("the bot running itself").
 *
 * Guarantees:
 *   * Single-flight: a tick is only rescheduled after the previous one finishes,
 *     so ticks never overlap and a slow market call cannot stack requests.
 *   * Failures never stop the loop; they are recorded in `lastError` and the
 *     next tick proceeds.
 *   * It only ever calls `runTick`, which is dry-run/paper and rejects stale
 *     quotes. It never places a real order.
 */
export class BotRunner {
  private readonly db: SqlExecutor;
  private readonly provider: MarketDataProvider;
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly userId?: string;
  private readonly scheduler: Scheduler;
  private readonly onTick?: (status: BotStatus) => void;

  private _running = false;
  private _inFlight = false;
  private _handle: TimerHandle | null = null;
  private _tickCount = 0;
  private _lastTickAt: number | null = null;
  private _nextTickAt: number | null = null;
  private _lastResult: TickResult | null = null;
  private _lastError: string | null = null;

  constructor(deps: BotRunnerDeps) {
    this.db = deps.db;
    this.provider = deps.provider;
    this.intervalMs = deps.intervalMs ?? 30_000;
    if (this.intervalMs <= 0) throw new Error("invalid_interval");
    this.now = deps.now ?? (() => Date.now());
    this.userId = deps.userId;
    this.scheduler = deps.scheduler ?? defaultScheduler;
    this.onTick = deps.onTick;
  }

  status(): BotStatus {
    return {
      running: this._running,
      intervalMs: this.intervalMs,
      scope: this.userId ?? "all",
      tickCount: this._tickCount,
      lastTickAt: this._lastTickAt,
      nextTickAt: this._nextTickAt,
      lastResult: this._lastResult,
      lastError: this._lastError,
      inFlight: this._inFlight,
    };
  }

  /** Starts the loop. Idempotent. The first tick fires after one interval. */
  start(): BotStatus {
    if (this._running) return this.status();
    this._running = true;
    this.scheduleNext();
    return this.status();
  }

  /** Stops the loop. Idempotent. Any in-flight tick still completes. */
  stop(): BotStatus {
    this._running = false;
    if (this._handle !== null) {
      this.scheduler.clearTimer(this._handle);
      this._handle = null;
    }
    this._nextTickAt = null;
    return this.status();
  }

  /** Runs a single tick immediately, regardless of the schedule. */
  async runOnce(): Promise<TickResult> {
    return this.execute();
  }

  private scheduleNext(): void {
    if (!this._running) return;
    this._nextTickAt = this.now() + this.intervalMs;
    this._handle = this.scheduler.setTimer(() => {
      this._handle = null;
      void this.handleTimer();
    }, this.intervalMs);
  }

  private async handleTimer(): Promise<void> {
    if (!this._running) return;
    await this.execute().catch(() => undefined);
    if (this._running) this.scheduleNext();
  }

  private async execute(): Promise<TickResult> {
    if (this._inFlight) {
      return this._lastResult ?? { evaluated: 0, closed: 0, skipped: 0 };
    }
    this._inFlight = true;
    try {
      const result = await runTick(this.db, this.provider, this.userId);
      this._tickCount += 1;
      this._lastTickAt = this.now();
      this._lastResult = result;
      this._lastError = null;
      this.emit();
      return result;
    } catch (err) {
      this._lastTickAt = this.now();
      this._lastError = (err as Error).message;
      this.emit();
      throw err;
    } finally {
      this._inFlight = false;
    }
  }

  private emit(): void {
    try {
      this.onTick?.(this.status());
    } catch {
      // A logging failure must never break the loop.
    }
  }
}
