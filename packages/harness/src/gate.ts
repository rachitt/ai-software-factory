import type { ActionKind, ActionRequest, Environment, PolicyDecision } from "@factory/contracts";
import { evaluate } from "@factory/policy";
import type { FactoryConfig } from "./config.js";
import type { UsageTotals } from "./usage.js";

/** The subset of Claude Code's PreToolUse hook input this gate reads. */
export interface PreToolUseInput {
  session_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_use_id?: string;
  /** Present when the call comes from a subagent; it is the subagent's name. */
  agent_type?: string;
  agent_id?: string;
}

export interface GateDecision {
  permissionDecision: "deny" | "ask";
  reason: string;
}

/** The main Claude Code session acts as the factory controller on the owner's behalf. */
export const CONTROLLER_ROLE = "controller";
export const FACTORY_TOOL_PREFIX = "mcp__factory__";

interface Gated {
  action: ActionKind;
  environment: Environment;
  estimated_usd_cents?: number;
}

const BASH_RULES: Array<{ pattern: RegExp; gated: Gated }> = [
  { pattern: /\bvercel\b[^|;&]*--prod\b/, gated: { action: "deploy", environment: "production" } },
  { pattern: /\bnetlify\s+deploy\b[^|;&]*--prod\b/, gated: { action: "deploy", environment: "production" } },
  { pattern: /\b(flyctl|fly)\s+deploy\b|\bwrangler\s+(deploy|publish)\b|\bfirebase\s+deploy\b/, gated: { action: "deploy", environment: "production" } },
  { pattern: /\beas\s+submit\b|\bfastlane\b/, gated: { action: "deploy", environment: "production" } },
  { pattern: /\bvercel(\s+deploy)?\b|\bnetlify\s+deploy\b/, gated: { action: "deploy", environment: "preview" } },
  { pattern: /\b(npm|pnpm|yarn)\s+publish\b|\bgh\s+release\s+create\b/, gated: { action: "publish_content", environment: "production" } },
  { pattern: /\bstripe\s+\S+\s+create\b/, gated: { action: "accept_payment", environment: "production" } },
  { pattern: /\bterraform\s+apply\b|\bpulumi\s+up\b/, gated: { action: "create_infrastructure", environment: "production" } },
  { pattern: /\bsendmail\b|\bmail\s+-s\b/, gated: { action: "send_communication", environment: "production" } },
];

/**
 * Best-effort mapping of shell commands to gated actions. This is a backstop:
 * the primary control is that agents never hold production credentials.
 */
export function classifyBash(command: string): Gated | undefined {
  return BASH_RULES.find((r) => r.pattern.test(command))?.gated;
}

function gatedActions(input: PreToolUseInput): Gated[] {
  const { tool_name: tool, tool_input: args } = input;
  if (tool === "Agent" || tool === "Task" || tool === "Workflow") return [{ action: "spawn_worker", environment: "sandbox" }];
  if (tool === "WebSearch" || tool === "WebFetch") return [{ action: "external_read", environment: "sandbox" }];
  if (tool === "Bash" && typeof args.command === "string") {
    const g = classifyBash(args.command);
    return g ? [g] : [];
  }
  if (tool === `${FACTORY_TOOL_PREFIX}decision_record` && args.decision === "build") {
    return [{ action: "approve_investment", environment: "production" }];
  }
  if (tool === `${FACTORY_TOOL_PREFIX}experiment_authorize` && Array.isArray(args.actions)) {
    const estimate = typeof args.budget_usd_cents === "number" ? args.budget_usd_cents : 0;
    return args.actions
      .filter((a): a is ActionKind => typeof a === "string")
      .map((action) => ({ action, environment: "production" as const, estimated_usd_cents: estimate }));
  }
  return [];
}

const SEVERITY: Record<PolicyDecision["effect"], number> = { allow: 0, escalate: 1, deny: 2 };

/**
 * PreToolUse gate. Returns undefined to leave Claude Code's normal permission
 * flow in charge, so factory policy can only restrict, never widen, what the
 * session is already allowed to do.
 */
export function gate(input: PreToolUseInput, config: FactoryConfig, usage: UsageTotals): GateDecision | undefined {
  const role = input.agent_type ?? CONTROLLER_ROLE;

  // Attribution: factory records name the role that produced them, and that
  // name must match the subagent Claude Code reports, not a self-declared one.
  if (input.tool_name.startsWith(FACTORY_TOOL_PREFIX) && "actor_role" in input.tool_input) {
    if (input.tool_input.actor_role !== role) {
      return { permissionDecision: "deny", reason: `actor_role must be "${role}" for this caller` };
    }
  }

  const gated = gatedActions(input);
  if (gated.some((g) => g.action === "spawn_worker") && usage.usd_cents >= config.budgets.portfolio_usd_cents) {
    return {
      permissionDecision: "deny",
      reason: `portfolio budget exhausted: $${(usage.usd_cents / 100).toFixed(2)} of $${(config.budgets.portfolio_usd_cents / 100).toFixed(2)} spent; raise budgets.portfolio_usd_cents in .factory/config.yaml`,
    };
  }

  let worst: PolicyDecision | undefined;
  for (const g of gated) {
    const request: ActionRequest = {
      request_id: input.tool_use_id ?? `${input.session_id}:${input.tool_name}`,
      action: g.action,
      environment: g.environment,
      actor: { role_version: `${role}-v1`, worker_id: input.agent_id ?? input.session_id },
      estimated_usd_cents: g.estimated_usd_cents ?? 0,
      idempotency_key: input.tool_use_id ?? input.session_id,
    };
    const decision = evaluate(config.policies, request);
    if (!worst || SEVERITY[decision.effect] > SEVERITY[worst.effect]) worst = decision;
  }

  if (!worst || worst.effect === "allow") return undefined;
  const owner = worst.exception_owner ? ` (exception owner: ${worst.exception_owner})` : "";
  return {
    permissionDecision: worst.effect === "deny" ? "deny" : "ask",
    reason: `factory policy: ${worst.reason}${owner}`,
  };
}
