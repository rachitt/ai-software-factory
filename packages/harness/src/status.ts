import { readFileSync } from "node:fs";
import type { UsageTotals } from "./usage.js";

/** Snapshot written by the factory MCP server after every change, read by hooks. */
export interface StatusSnapshot {
  generated_at: string;
  opportunities: Array<{
    opportunity_id: string;
    category: string;
    state: string;
    resume_to?: string;
    evidence_stage?: string;
    attractiveness?: number;
    confidence?: string;
    evidence_count: number;
  }>;
  attention: string[];
  usage: UsageTotals;
  budget_usd_cents: number;
}

export function readStatus(path: string): StatusSnapshot | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as StatusSnapshot;
  } catch {
    return undefined;
  }
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** Compact, factual context injected at session start so work survives context resets. */
export function renderStatus(s: StatusSnapshot | undefined, live: UsageTotals, budgetCents: number): string {
  const lines = ["AI software factory status (from .factory/status.json):"];
  lines.push(`Model spend: ${dollars(live.usd_cents)} of ${dollars(budgetCents)} portfolio budget (notional API-equivalent).`);
  if (!s) {
    lines.push("No factory state yet. Run /factory to see how to start, or /factory-discover <category> to begin research.");
    return lines.join("\n");
  }
  if (s.opportunities.length === 0) lines.push("No opportunities yet.");
  for (const o of s.opportunities) {
    const extra = [
      o.evidence_stage && `stage ${o.evidence_stage}`,
      o.attractiveness !== undefined && `attractiveness ${o.attractiveness}/5`,
      o.confidence && `confidence ${o.confidence}`,
      `${o.evidence_count} evidence`,
    ].filter(Boolean);
    const state = o.resume_to ? `${o.state} (resumes to ${o.resume_to})` : o.state;
    lines.push(`- ${o.opportunity_id} [${o.category}]: ${state}; ${extra.join(", ")}`);
  }
  if (s.attention.length) {
    lines.push("Needs the owner's attention:");
    for (const a of s.attention) lines.push(`- ${a}`);
  }
  lines.push(`Snapshot taken ${s.generated_at}. Use the factory MCP status tool for live detail.`);
  return lines.join("\n");
}
