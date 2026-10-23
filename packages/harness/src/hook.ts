#!/usr/bin/env node
/**
 * Claude Code hook entry point: `node hook.js <pre-tool-use|session-start|subagent-stop|stop>`.
 * Reads the hook payload from stdin and writes the hook response to stdout.
 */
import { factoryPaths, loadConfig, projectDir } from "./config.js";
import { gate, type PreToolUseInput } from "./gate.js";
import { readStatus, renderStatus } from "./status.js";
import { recordUsage, usageTotals } from "./usage.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function respond(output: unknown): void {
  process.stdout.write(JSON.stringify(output));
}

async function main(): Promise<void> {
  const event = process.argv[2];
  const input = JSON.parse((await readStdin()) || "{}");
  const paths = factoryPaths(projectDir());

  switch (event) {
    case "pre-tool-use": {
      try {
        const decision = gate(input as PreToolUseInput, loadConfig(paths), usageTotals(paths.usage));
        if (decision) {
          respond({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: decision.permissionDecision,
              permissionDecisionReason: decision.reason,
            },
          });
        }
      } catch (err) {
        // Fail closed: a gated tool never runs without a policy decision.
        respond({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: `factory policy gate failed (${(err as Error).message}); fix .factory/config.yaml or run pnpm build`,
          },
        });
      }
      return;
    }
    case "session-start": {
      const config = loadConfig(paths);
      respond({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: renderStatus(readStatus(paths.status), usageTotals(paths.usage), config.budgets.portfolio_usd_cents),
        },
      });
      return;
    }
    case "subagent-stop": {
      if (input.agent_transcript_path && input.agent_id) {
        recordUsage(paths.usage, "agent", input.agent_id, input.agent_transcript_path, loadConfig(paths).pricing, input.agent_type);
      }
      return;
    }
    case "stop": {
      if (input.transcript_path && input.session_id) {
        recordUsage(paths.usage, "session", input.session_id, input.transcript_path, loadConfig(paths).pricing);
      }
      return;
    }
    default:
      throw new Error(`unknown hook event ${event}`);
  }
}

main().catch((err: Error) => {
  // Non-blocking for observational hooks; the message shows in Claude Code's hook output.
  process.stderr.write(`factory hook error: ${err.message}\n`);
  process.exit(1);
});
