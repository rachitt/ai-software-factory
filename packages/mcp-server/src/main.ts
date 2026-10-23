#!/usr/bin/env node
/**
 * Factory MCP server (stdio). Claude Code starts one per session from .mcp.json.
 * State lives in an embedded Postgres (PGlite) under .factory/state/, which a
 * single process may open at a time, so the server holds a lock file.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { migrate } from "@factory/control-plane";
import { factoryPaths, loadConfig, projectDir, usageTotals, type FactoryPaths } from "@factory/harness";
import { FactoryService } from "./service.js";
import { registerTools } from "./tools.js";

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLock(paths: FactoryPaths): void {
  mkdirSync(paths.state, { recursive: true });
  try {
    writeFileSync(paths.lock, String(process.pid), { flag: "wx" });
  } catch {
    const holder = Number(readFileSync(paths.lock, "utf8"));
    if (holder && holder !== process.pid && alive(holder)) {
      throw new Error(`factory state is open in another session (pid ${holder}); close that Claude Code session first`);
    }
    writeFileSync(paths.lock, String(process.pid));
  }
}

async function main(): Promise<void> {
  const paths = factoryPaths(projectDir());
  loadConfig(paths); // fail fast on an invalid config
  acquireLock(paths);
  const release = () => rmSync(paths.lock, { force: true });
  process.on("exit", release);

  const db = await PGlite.create(paths.pgdata);
  await migrate(db);

  const writeStatus = async () => {
    const snapshot = await factory.status();
    writeFileSync(`${paths.status}.tmp`, JSON.stringify(snapshot, null, 2));
    renameSync(`${paths.status}.tmp`, paths.status);
  };
  const factory = new FactoryService({
    db,
    config: () => loadConfig(paths),
    usage: () => usageTotals(paths.usage),
    onChange: writeStatus,
  });
  await writeStatus();

  const server = new McpServer({ name: "factory", version: "0.1.0" });
  registerTools(server, factory);
  await server.connect(new StdioServerTransport());

  const shutdown = async () => {
    await server.close();
    await db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.stdin.on("close", shutdown);
}

main().catch((err: Error) => {
  process.stderr.write(`factory MCP server failed: ${err.message}\n`);
  process.exit(1);
});
