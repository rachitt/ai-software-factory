/**
 * Minimal database surface used by the control plane. PGlite satisfies it
 * directly; a node-postgres pool adapter is a thin wrapper.
 */
export interface Queryable {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
}

export interface Db extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
}

/** Postgres unique_violation. */
export const UNIQUE_VIOLATION = "23505";

export function pgErrorCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : undefined;
}
