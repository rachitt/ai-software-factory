import { readdirSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";

export interface TokenCounts {
  input: number;
  output: number;
  cache_write: number;
  cache_read: number;
}

/**
 * Tokens that count against the budget: everything the model processed fresh.
 * Cache reads re-read the same context on every turn, so they would dwarf the
 * real work; they are recorded but reported separately.
 */
export const countedTokens = (t: TokenCounts): number => t.input + t.output + t.cache_write;

export interface UsageRecord {
  agent_id: string;
  agent_type: string;
  by_model: Record<string, TokenCounts>;
  tokens: number;
  cache_read_tokens: number;
}

const empty = (): TokenCounts => ({ input: 0, output: 0, cache_write: 0, cache_read: 0 });

interface TranscriptUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
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
    t.input += u.input_tokens ?? 0;
    t.output += u.output_tokens ?? 0;
    t.cache_write += u.cache_creation_input_tokens ?? 0;
    t.cache_read += u.cache_read_input_tokens ?? 0;
  }
  return byModel;
}

/**
 * Writes one usage file per factory subagent. Rewriting the whole file keeps
 * this idempotent: re-running the hook on a longer transcript replaces the
 * earlier total instead of double-counting it.
 */
export function recordUsage(usageDir: string, agentId: string, agentType: string, transcriptPath: string): UsageRecord {
  const by_model = tokensFromTranscript(readFileSync(transcriptPath, "utf8"));
  const models = Object.values(by_model);
  const record: UsageRecord = {
    agent_id: agentId,
    agent_type: agentType,
    by_model,
    tokens: models.reduce((n, t) => n + countedTokens(t), 0),
    cache_read_tokens: models.reduce((n, t) => n + t.cache_read, 0),
  };
  mkdirSync(usageDir, { recursive: true });
  const file = join(usageDir, `agent-${agentId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
  writeFileSync(`${file}.tmp`, JSON.stringify(record, null, 2));
  renameSync(`${file}.tmp`, file);
  return record;
}

export interface UsageTotals {
  tokens: number;
  cache_read_tokens: number;
  agents: number;
  by_agent_type: Record<string, number>;
}

export const NO_USAGE: UsageTotals = { tokens: 0, cache_read_tokens: 0, agents: 0, by_agent_type: {} };

export function usageTotals(usageDir: string): UsageTotals {
  const totals: UsageTotals = { ...NO_USAGE, by_agent_type: {} };
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
    if (typeof r.tokens !== "number") continue;
    totals.tokens += r.tokens;
    totals.cache_read_tokens += r.cache_read_tokens ?? 0;
    totals.agents++;
    totals.by_agent_type[r.agent_type] = (totals.by_agent_type[r.agent_type] ?? 0) + r.tokens;
  }
  return totals;
}
