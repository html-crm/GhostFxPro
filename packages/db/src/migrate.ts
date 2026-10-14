import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";

const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations",
);

/** Returns migration filenames in deterministic (lexical) order. */
export async function listMigrations(): Promise<string[]> {
  const files = await readdir(migrationsDir);
  return files.filter((f) => f.endsWith(".sql")).sort();
}

/**
 * Applies every not-yet-applied migration in order, recording each in
 * `schema_migrations`. Idempotent: safe to call on every boot.
 */
export async function migrate(db: PGlite): Promise<string[]> {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename   text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     );`,
  );
  const existing = await db.query<{ filename: string }>(
    `SELECT filename FROM schema_migrations`,
  );
  const applied = new Set(existing.rows.map((r) => r.filename));

  const ran: string[] = [];
  for (const file of await listMigrations()) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(migrationsDir, file), "utf8");
    await db.exec(sql);
    await db.query(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [
      file,
    ]);
    ran.push(file);
  }
  return ran;
}
