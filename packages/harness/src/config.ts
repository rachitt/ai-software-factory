import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { Policy, RoleCatalog, Slug } from "@factory/contracts";

/** Owner-edited factory configuration at `.factory/config.yaml`. */
export const FactoryConfig = z.object({
  portfolio_id: Slug,
  policies: z.array(Policy).min(1),
  budgets: z.object({
    /** Tokens factory subagents may use in total (see `countedTokens`). */
    portfolio_tokens: z.number().int().positive(),
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
  catalog: string;
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
    catalog: join(projectDir, "roles", "catalog.yaml"),
  };
}

/** Claude Code exports CLAUDE_PROJECT_DIR to hooks and project MCP servers. */
export function projectDir(): string {
  return process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
}

export function loadConfig(paths: FactoryPaths): FactoryConfig {
  return FactoryConfig.parse(parse(readFileSync(paths.config, "utf8")));
}

/** Every role id in the catalog; only these subagents count as factory work. */
export function loadFactoryRoles(paths: FactoryPaths): Set<string> {
  return new Set(RoleCatalog.parse(parse(readFileSync(paths.catalog, "utf8"))).roles.map((r) => r.role_id));
}
