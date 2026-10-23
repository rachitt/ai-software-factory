import type { ActionRequest, Policy, PolicyDecision, PolicyRule } from "@factory/contracts";

interface Match {
  policy: Policy;
  rule: PolicyRule;
}

function applies(policy: Policy, request: ActionRequest): boolean {
  return policy.scope.level === "portfolio" || policy.scope.product_id === request.actor.product_id;
}

function ruleMatches(rule: PolicyRule, request: ActionRequest): boolean {
  if (rule.action !== request.action) return false;
  if (rule.environments && !rule.environments.includes(request.environment)) return false;
  if (rule.release_categories) {
    if (!request.release_category || !rule.release_categories.includes(request.release_category)) return false;
  }
  if (rule.tools) {
    if (!request.tool || !rule.tools.includes(request.tool)) return false;
  }
  return true;
}

function decision(effect: PolicyDecision["effect"], reason: string, match?: Match): PolicyDecision {
  if (!match) return { effect, reason };
  return {
    effect,
    reason,
    policy_id: match.policy.policy_id,
    policy_version: match.policy.version,
    rule_id: match.rule.rule_id,
    exception_owner: match.rule.exception_owner,
  };
}

/**
 * Decides whether an action may proceed. Enforced by services, not prompts:
 * the request carries no self-authorization, and an agent's plan is never a grant.
 *
 * Semantics across every applicable portfolio and product policy:
 *   1. Any matching deny rule denies.
 *   2. Otherwise any matching escalate rule escalates to its exception owner.
 *   3. Otherwise an allow rule whose spend cap covers the estimate allows.
 *   4. Allow rules that match but whose cap is exceeded escalate.
 *   5. Nothing matched: deny.
 */
export function evaluate(policies: readonly Policy[], request: ActionRequest): PolicyDecision {
  const matches: Match[] = [];
  for (const policy of policies) {
    if (!applies(policy, request)) continue;
    for (const rule of policy.rules) if (ruleMatches(rule, request)) matches.push({ policy, rule });
  }

  const deny = matches.find((m) => m.rule.effect === "deny");
  if (deny) return decision("deny", `denied by rule ${deny.rule.rule_id}`, deny);

  const escalate = matches.find((m) => m.rule.effect === "escalate");
  if (escalate) return decision("escalate", `rule ${escalate.rule.rule_id} requires an authorized decision`, escalate);

  const allows = matches.filter((m) => m.rule.effect === "allow");
  const within = allows.find(
    (m) => m.rule.max_usd_cents_per_action === undefined || request.estimated_usd_cents <= m.rule.max_usd_cents_per_action,
  );
  if (within) return decision("allow", `allowed by rule ${within.rule.rule_id}`, within);

  const capped = allows[0];
  if (capped) {
    return decision(
      "escalate",
      `estimate ${request.estimated_usd_cents} exceeds cap ${capped.rule.max_usd_cents_per_action} of rule ${capped.rule.rule_id}`,
      capped,
    );
  }

  return decision("deny", `no rule permits ${request.action} in ${request.environment}`);
}
