import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { migrate } from "@ghostfx/db";
import { buildApp } from "./app.ts";
import type { SqlExecutor } from "./db.ts";
import { seedPermissions } from "./services/permissions.ts";
import { bootstrapSuperAdmin } from "./services/bootstrap.ts";

/**
 * Development entrypoint backed by PGlite (file-persisted PostgreSQL/WASM).
 * No external database required. NOT for production. Live trading is disabled;
 * this process only serves the auth/admin API.
 */
async function main(): Promise<void> {
  const dataDir =
    process.env.PGLITE_DATA_DIR ?? join(process.cwd(), ".pglite-data");
  await mkdir(dataDir, { recursive: true });

  const pglite = new PGlite(dataDir);
  const db: SqlExecutor = {
    async query<T>(sql: string, params?: unknown[]) {
      const res = await pglite.query(sql, params as never);
      return { rows: res.rows as T[] };
    },
  };

  const ran = await migrate(pglite);
  await seedPermissions(db);

  const email = process.env.SUPER_ADMIN_EMAIL ?? "danialoo.crypto@gmail.com";
  const displayName = process.env.SUPER_ADMIN_NAME ?? "Danialoo";
  const bootstrap = await bootstrapSuperAdmin(db, { email, displayName });

  const app = buildApp({
    db,
    config: {
      sessionTtlMs: Number(process.env.SESSION_TTL_MS ?? 12 * 60 * 60 * 1000),
      // Dev-only key. Production must supply MFA_ENCRYPTION_KEY.
      mfaEncryptionKey: process.env.MFA_ENCRYPTION_KEY
        ? Buffer.from(process.env.MFA_ENCRYPTION_KEY, "base64")
        : randomBytes(32),
    },
  });

  const port = Number(process.env.PORT ?? 4000);
  const host = process.env.HOST ?? "127.0.0.1";
  await app.listen({ port, host });

  console.log(`[api] dev server on http://${host}:${port}`);
  console.log(
    `[api] migrations applied this boot: ${ran.length ? ran.join(", ") : "none"}`,
  );
  if (bootstrap.created && bootstrap.invitationToken) {
    console.log(`[api] bootstrapped SUPER_ADMIN ${email}`);
    console.log(`[api] invitation token (single use): ${bootstrap.invitationToken}`);
  } else {
    console.log(`[api] SUPER_ADMIN ${email} already exists (idempotent)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
