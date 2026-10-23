import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { Policy, Slug, UsdCents } from "@factory/contracts";

/** USD per million tokens. */
const ModelPrice = z.object({
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cache_write_5m: z.number().nonnegative(),
  cache_write_1h: z.number().nonnegative(),
  cache_read: z.number().nonnegative(),
});
export type ModelPrice = z.infer<typeof ModelPrice>;

/** Owner-edited factory configuration at `.factory/config.yaml`. */
export const FactoryConfig = z.object({
  portfolio_id: Slug,
  policies: z.array(Policy).min(1),
  budgets: z.object({
    /** Notional model spend across all factory sessions and subagents. */
    portfolio_usd_cents: UsdCents,
  }),
  pricing: z.object({
    as_of: z.string().min(1),
    models: z.record(z.string(), ModelPrice),
    /** Used for models missing from the table so spend is never silently zero. */
    fallback: ModelPrice,
  }),
});
export type FactoryConfig = z.infer<typeof FactoryConfig>;

export interface FactoryPaths {
  root: string;
  config: string;
  state: string;
  pgdata: string;
  lock: string;
  usage: string;
  status: string;
}

export function factoryPaths(projectDir: string): FactoryPaths {
  const root = join(projectDir, ".factory");
  const state = join(root, "state");
  return {
    root,
    config: join(root, "config.yaml"),
    state,
    pgdata: join(state, "pgdata"),
    lock: join(state, "server.lock"),
    usage: join(root, "usage"),
    status: join(root, "status.json"),
  };
}

/** Claude Code exports CLAUDE_PROJECT_DIR to hooks and project MCP servers. */
export function projectDir(): string {
  return process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
}

export function loadConfig(paths: FactoryPaths): FactoryConfig {
  return FactoryConfig.parse(parse(readFileSync(paths.config, "utf8")));
}
