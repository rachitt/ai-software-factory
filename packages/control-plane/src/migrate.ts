import { readdir, readFile } from "node:fs/promises";
import type { Db } from "./db.js";

export const MIGRATIONS_DIR = new URL("../migrations/", import.meta.url);

/** Applies pending `NNNN_name.sql` migrations in order, each in its own transaction. Returns applied names. */
export async function migrate(db: Db, dir: URL = MIGRATIONS_DIR): Promise<string[]> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const { rows } = await db.query<{ name: string }>("SELECT name FROM schema_migrations");
  const applied = new Set(rows.map((r) => r.name));

  const files = (await readdir(dir)).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
  const pending = files.filter((f) => !applied.has(f));
  for (const file of pending) {
    const sql = await readFile(new URL(file, dir), "utf8");
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
    });
  }
  return pending;
}
