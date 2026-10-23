import { readdirSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { FactoryConfig, ModelPrice } from "./config.js";

export interface TokenCounts {
  input: number;
  output: number;
  cache_write_5m: number;
  cache_write_1h: number;
  cache_read: number;
}

export interface UsageRecord {
  kind: "session" | "agent";
  id: string;
  agent_type?: string;
  by_model: Record<string, TokenCounts>;
  /** Notional API-equivalent cost; rounded up to whole cents. */
  usd_cents: number;
  pricing_as_of: string;
}

const empty = (): TokenCounts => ({ input: 0, output: 0, cache_write_5m: 0, cache_write_1h: 0, cache_read: 0 });

interface TranscriptUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
}

/**
 * Sums token usage from a Claude Code transcript (JSONL). One API response is
 * split across several lines that repeat the same usage, so lines are
 * deduplicated by message id. Malformed lines are skipped.
 */
export function tokensFromTranscript(jsonl: string): Record<string, TokenCounts> {
  const seen = new Set<string>();
  const byModel: Record<string, TokenCounts> = {};
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let entry: { message?: { id?: string; model?: string; usage?: TranscriptUsage } };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = entry.message;
    if (!msg?.usage || !msg.model || !msg.id || seen.has(msg.id)) continue;
    seen.add(msg.id);
    const u = msg.usage;
    const t = (byModel[msg.model] ??= empty());
    const write1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
    const write5m = u.cache_creation?.ephemeral_5m_input_tokens ?? (u.cache_creation_input_tokens ?? 0) - write1h;
    t.input += u.input_tokens ?? 0;
    t.output += u.output_tokens ?? 0;
    t.cache_read += u.cache_read_input_tokens ?? 0;
    t.cache_write_5m += Math.max(0, write5m);
    t.cache_write_1h += write1h;
  }
  return byModel;
}

export function costCents(byModel: Record<string, TokenCounts>, pricing: FactoryConfig["pricing"]): number {
  let usd = 0;
  for (const [model, t] of Object.entries(byModel)) {
    const p: ModelPrice = pricing.models[model] ?? pricing.fallback;
    usd +=
      (t.input * p.input +
        t.output * p.output +
        t.cache_write_5m * p.cache_write_5m +
        t.cache_write_1h * p.cache_write_1h +
        t.cache_read * p.cache_read) /
      1_000_000;
  }
  return Math.ceil(usd * 100);
}

/**
 * Writes one usage file per session or subagent. Rewriting the whole file
 * keeps this idempotent: re-running a hook on a longer transcript replaces the
 * earlier total instead of double-counting it.
 */
export function recordUsage(
  usageDir: string,
  kind: UsageRecord["kind"],
  id: string,
  transcriptPath: string,
  pricing: FactoryConfig["pricing"],
  agentType?: string,
): UsageRecord {
  const by_model = tokensFromTranscript(readFileSync(transcriptPath, "utf8"));
  const record: UsageRecord = { kind, id, by_model, usd_cents: costCents(by_model, pricing), pricing_as_of: pricing.as_of };
  if (agentType) record.agent_type = agentType;
  mkdirSync(usageDir, { recursive: true });
  const file = join(usageDir, `${kind}-${id.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
  writeFileSync(`${file}.tmp`, JSON.stringify(record, null, 2));
  renameSync(`${file}.tmp`, file);
  return record;
}

export interface UsageTotals {
  usd_cents: number;
  sessions: number;
  agents: number;
  by_agent_type: Record<string, number>;
}

export function usageTotals(usageDir: string): UsageTotals {
  const totals: UsageTotals = { usd_cents: 0, sessions: 0, agents: 0, by_agent_type: {} };
  let files: string[];
  try {
    files = readdirSync(usageDir).filter((f) => f.endsWith(".json"));
  } catch {
    return totals;
  }
  for (const f of files) {
    let r: UsageRecord;
    try {
      r = JSON.parse(readFileSync(join(usageDir, f), "utf8"));
    } catch {
      continue;
    }
    totals.usd_cents += r.usd_cents;
    if (r.kind === "session") totals.sessions++;
    else {
      totals.agents++;
      const k = r.agent_type ?? "unknown";
      totals.by_agent_type[k] = (totals.by_agent_type[k] ?? 0) + r.usd_cents;
    }
  }
  return totals;
}
