import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { RoleCatalog } from "@factory/contracts";
import { ROLE_GRANTS, type FactoryService, registerTools } from "./index.js";

// Checks that the Claude Code wiring (.claude/, .mcp.json) agrees with the code it drives.
const root = new URL("../../..", import.meta.url).pathname;
const catalog = RoleCatalog.parse(parse(readFileSync(join(root, "roles/catalog.yaml"), "utf8")));
const agentsDir = join(root, ".claude/agents");
const agents = readdirSync(agentsDir)
  .filter((f) => f.endsWith(".md"))
  .map((file) => {
    const frontmatter = readFileSync(join(agentsDir, file), "utf8").match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
    const meta = parse(frontmatter) as { name: string; tools: string };
    return { file, name: meta.name, tools: meta.tools.split(",").map((t) => t.trim()) };
  });

function toolNames(): string[] {
  const names: string[] = [];
  const fake = { registerTool: (name: string) => names.push(name) } as unknown as McpServer;
  registerTools(fake, {} as FactoryService);
  return names;
}

describe("Claude Code wiring", () => {
  it("names each subagent after an active catalog role", () => {
    expect(agents.length).toBeGreaterThan(0);
    for (const a of agents) {
      expect(a.file, a.file).toBe(`${a.name}.md`);
      expect(catalog.roles.find((r) => r.role_id === a.name)?.active, a.name).toBe(true);
    }
  });

  it("only gives agents factory tools that exist and that their role may use", () => {
    const tools = new Set(toolNames());
    const reads = new Set(["status", "get_opportunity", "get_contract_schema"]);
    for (const a of agents) {
      for (const t of a.tools.filter((t) => t.startsWith("mcp__factory__"))) {
        const name = t.slice("mcp__factory__".length);
        expect(tools.has(name), `${a.name}: ${t}`).toBe(true);
        if (reads.has(name)) continue;
        const grant = ROLE_GRANTS[name as keyof typeof ROLE_GRANTS] as readonly string[] | undefined;
        expect(grant?.includes(a.name), `${a.name} lists ${t} but ROLE_GRANTS does not allow it`).toBe(true);
      }
    }
  });

  it("grants records only to catalog roles or the controller", () => {
    const ids = new Set(catalog.roles.map((r) => r.role_id));
    for (const roles of Object.values(ROLE_GRANTS)) for (const r of roles) expect(r === "controller" || ids.has(r), r).toBe(true);
  });

  it("points .mcp.json and hooks at the built entry points", () => {
    const mcp = JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8"));
    expect(mcp.mcpServers.factory.args[0]).toMatch(/packages\/mcp-server\/dist\/main\.js$/);
    expect(existsSync(join(root, "packages/mcp-server/src/main.ts"))).toBe(true);
    const settings = JSON.parse(readFileSync(join(root, ".claude/settings.json"), "utf8"));
    const commands = JSON.stringify(settings.hooks);
    for (const event of ["pre-tool-use", "session-start", "subagent-stop"]) {
      expect(commands).toContain(`packages/harness/dist/hook.js\\" ${event}`);
    }
  });
});
