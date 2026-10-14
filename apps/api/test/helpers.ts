import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import type { FastifyInstance } from "fastify";
import { MockProvider, type MarketDataProvider } from "@ghostfx/bot";
import { migrate } from "@ghostfx/db";
import { buildApp, type AppConfig } from "../src/app.ts";
import type { SqlExecutor } from "../src/db.ts";

export { MockProvider };

export interface TestApp {
  app: FastifyInstance;
  db: SqlExecutor;
  config: AppConfig;
  pglite: PGlite;
  close: () => Promise<void>;
}

export interface TestAppOptions {
  market?: MarketDataProvider;
  now?: () => number;
}

export async function makeTestApp(opts: TestAppOptions = {}): Promise<TestApp> {
  const pglite = new PGlite();
  await migrate(pglite);
  const db: SqlExecutor = {
    async query<T>(sql: string, params?: unknown[]) {
      const res = await pglite.query(sql, params as never);
      return { rows: res.rows as T[] };
    },
  };
  const config: AppConfig = {
    sessionTtlMs: 60 * 60 * 1000,
    mfaEncryptionKey: randomBytes(32),
  };
  const app = buildApp({
    db,
    config,
    market: opts.market ?? new MockProvider({}),
    now: opts.now,
  });
  await app.ready();
  return {
    app,
    db,
    config,
    pglite,
    close: async () => {
      await app.close();
      await pglite.close();
    },
  };
}

export async function register(
  app: FastifyInstance,
  email: string,
  password: string,
  displayName = "Tester",
) {
  return app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email, password, displayName },
  });
}

export async function login(
  app: FastifyInstance,
  email: string,
  password: string,
  totp?: string,
) {
  return app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, password, ...(totp ? { totp } : {}) },
  });
}

export function authed(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}
