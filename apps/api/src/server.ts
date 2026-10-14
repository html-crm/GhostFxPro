import { Pool } from "pg";
import { parseEncryptionKey } from "@ghostfx/security";
import { buildApp } from "./app.ts";
import type { SqlExecutor } from "./db.ts";
import { seedPermissions } from "./services/permissions.ts";

/**
 * Production entrypoint. Requires a real PostgreSQL server and an MFA
 * encryption key. This path is UNTESTED in the current environment (no
 * PostgreSQL server available) and is documented as a known blocker.
 */
async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const keyRaw = process.env.MFA_ENCRYPTION_KEY;
  if (!keyRaw) throw new Error("MFA_ENCRYPTION_KEY is required");

  const pool = new Pool({ connectionString: databaseUrl });
  const db: SqlExecutor = {
    async query<T>(sql: string, params?: unknown[]) {
      const res = await pool.query(sql, params as unknown[]);
      return { rows: res.rows as T[] };
    },
  };

  await seedPermissions(db);

  const app = buildApp({
    db,
    config: {
      sessionTtlMs: Number(process.env.SESSION_TTL_MS ?? 12 * 60 * 60 * 1000),
      mfaEncryptionKey: parseEncryptionKey(keyRaw),
    },
  });

  const port = Number(process.env.PORT ?? 4000);
  await app.listen({ port, host: process.env.HOST ?? "0.0.0.0" });

  const shutdown = async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
