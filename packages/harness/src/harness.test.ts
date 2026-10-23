import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyBash,
  costCents,
  factoryPaths,
  gate,
  loadConfig,
  recordUsage,
  renderStatus,
  tokensFromTranscript,
  usageTotals,
  type PreToolUseInput,
  type UsageTotals,
} from "./index.js";

// The committed config is the real policy; test against it so edits that weaken it are noticed.
const config = loadConfig(factoryPaths(new URL("../../..", import.meta.url).pathname));
const noUsage: UsageTotals = { usd_cents: 0, sessions: 0, agents: 0, by_agent_type: {} };

const call = (tool_name: string, tool_input: Record<string, unknown>, agent_type?: string): PreToolUseInput => ({
  session_id: "s1",
  tool_name,
  tool_input,
  tool_use_id: "tu1",
  ...(agent_type && { agent_type, agent_id: "a1" }),
});

describe("policy gate", () => {
  it("defers ordinary research and local work to Claude Code's permissions", () => {
    expect(gate(call("WebSearch", { query: "x" }, "problem-evidence-analyst"), config, noUsage)).toBeUndefined();
    expect(gate(call("Bash", { command: "pnpm test" }), config, noUsage)).toBeUndefined();
    expect(gate(call("Read", { file_path: "/x" }), config, noUsage)).toBeUndefined();
  });

  it("asks the owner before build decisions and production deploys", () => {
    expect(gate(call("mcp__factory__decision_record", { actor_role: "controller", decision: "build" }), config, noUsage))
      .toMatchObject({ permissionDecision: "ask", reason: expect.stringMatching(/build-approval/) });
    expect(gate(call("mcp__factory__decision_record", { actor_role: "controller", decision: "reject" }), config, noUsage)).toBeUndefined();
    expect(gate(call("Bash", { command: "npx vercel deploy --prod" }), config, noUsage)?.permissionDecision).toBe("ask");
    expect(gate(call("Bash", { command: "npx vercel deploy" }), config, noUsage)).toBeUndefined();
  });

  it("denies actions the policy forbids", () => {
    expect(gate(call("Bash", { command: "stripe prices create --unit-amount 800" }), config, noUsage)?.permissionDecision).toBe("deny");
    const auth = call("mcp__factory__experiment_authorize", {
      actor_role: "controller",
      experiment_id: "landing-1",
      actions: ["publish_content", "spend_money"],
      budget_usd_cents: 5000,
    });
    expect(gate(auth, config, noUsage)).toMatchObject({ permissionDecision: "deny", reason: expect.stringMatching(/no-spend-yet/) });
  });

  it("rejects records attributed to a different role than the caller", () => {
    const forged = call("mcp__factory__review_submit", { actor_role: "demand-skeptic" }, "demand-intelligence-lead");
    expect(gate(forged, config, noUsage)).toEqual({ permissionDecision: "deny", reason: 'actor_role must be "demand-intelligence-lead" for this caller' });
    expect(gate(call("mcp__factory__review_submit", { actor_role: "demand-skeptic" }), config, noUsage)?.permissionDecision).toBe("deny");
    expect(gate(call("mcp__factory__review_submit", { actor_role: "demand-skeptic" }, "demand-skeptic"), config, noUsage)).toBeUndefined();
  });

  it("refuses new workers once the portfolio budget is spent", () => {
    const spent = { ...noUsage, usd_cents: config.budgets.portfolio_usd_cents };
    expect(gate(call("Agent", { subagent_type: "demand-skeptic" }), config, spent)?.permissionDecision).toBe("deny");
    expect(gate(call("Workflow", { name: "factory-discover" }), config, spent)?.permissionDecision).toBe("deny");
    expect(gate(call("Agent", {}), config, noUsage)).toBeUndefined();
  });

  it("classifies risky shell commands", () => {
    expect(classifyBash("cd app && fly deploy")).toEqual({ action: "deploy", environment: "production" });
    expect(classifyBash("pnpm publish --access public")?.action).toBe("publish_content");
    expect(classifyBash("git status")).toBeUndefined();
  });
});

describe("usage accounting", () => {
  const line = (id: string, model: string, usage: object) => JSON.stringify({ type: "assistant", message: { id, model, usage } });
  const transcript = [
    line("m1", "claude-opus-5-5", { input_tokens: 1_000_000, output_tokens: 100_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
    line("m1", "claude-opus-5-5", { input_tokens: 1_000_000, output_tokens: 100_000 }), // same response, second content block
    line("m2", "claude-haiku-5-5", {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 2_000_000,
      cache_creation_input_tokens: 1_000_000,
      cache_creation: { ephemeral_5m_input_tokens: 600_000, ephemeral_1h_input_tokens: 400_000 },
    }),
    "not json",
    JSON.stringify({ type: "user", message: { content: "hi" } }),
  ].join("\n");

  it("dedupes split messages and separates cache writes", () => {
    expect(tokensFromTranscript(transcript)).toEqual({
      "claude-opus-5-5": { input: 1_000_000, output: 100_000, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0 },
      "claude-haiku-5-5": { input: 0, output: 0, cache_read: 2_000_000, cache_write_5m: 600_000, cache_write_1h: 400_000 },
    });
  });

  it("prices usage and prices unknown models at the fallback tier", () => {
    // Opus: $4 + $2 = $6.00. Haiku: 0.02 + 0.075 + 0.08 = $0.175 → total 617.5 → 618 cents
    expect(costCents(tokensFromTranscript(transcript), config.pricing)).toBe(618);
    expect(costCents({ "mystery-model": { input: 1_000_000, output: 0, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0 } }, config.pricing)).toBe(1000);
  });

  it("records idempotently per session or agent and totals by role", () => {
    const dir = mkdtempSync(join(tmpdir(), "factory-usage-"));
    const t = join(dir, "t.jsonl");
    writeFileSync(t, transcript);
    recordUsage(join(dir, "usage"), "agent", "a1", t, config.pricing, "demand-skeptic");
    recordUsage(join(dir, "usage"), "agent", "a1", t, config.pricing, "demand-skeptic");
    recordUsage(join(dir, "usage"), "session", "s1", t, config.pricing);
    expect(usageTotals(join(dir, "usage"))).toEqual({ usd_cents: 1236, sessions: 1, agents: 1, by_agent_type: { "demand-skeptic": 618 } });
    expect(usageTotals(join(dir, "missing")).usd_cents).toBe(0);
  });
});

describe("status rendering", () => {
  it("states budget and what needs attention", () => {
    const text = renderStatus(
      {
        generated_at: "2026-10-23T12:00:00Z",
        opportunities: [{ opportunity_id: "travel-vocab", category: "learning", state: "needs_input", resume_to: "experiment_ready", evidence_count: 12 }],
        attention: ["travel-vocab: decide whether to build"],
        usage: noUsage,
        budget_usd_cents: 5000,
      },
      { ...noUsage, usd_cents: 1234 },
      5000,
    );
    expect(text).toContain("Model spend: $12.34 of $50.00");
    expect(text).toContain("- travel-vocab [learning]: needs_input (resumes to experiment_ready); 12 evidence");
    expect(text).toContain("- travel-vocab: decide whether to build");
  });
});
