import { z } from "zod";
import { RoleVersionRef, Slug, UsdCents, Version } from "./common.js";

/** Actions that are checked by the tool gateway and execution services. */
export const ActionKind = z.enum([
  "model_call",
  "sandbox_exec",
  "external_read",
  "spawn_worker",
  "publish_content",
  "send_communication",
  "spend_money",
  "accept_payment",
  "create_infrastructure",
  "deploy",
  "modify_production_data",
]);
export type ActionKind = z.infer<typeof ActionKind>;

export const Environment = z.enum(["sandbox", "preview", "staging", "production"]);
export type Environment = z.infer<typeof Environment>;

export const ReleaseCategory = z.enum([
  "routine_fix",
  "feature",
  "data_migration",
  "security_fix",
  "pricing_change",
  "public_distribution",
]);
export type ReleaseCategory = z.infer<typeof ReleaseCategory>;

export const PolicyEffect = z.enum(["allow", "deny", "escalate"]);
export type PolicyEffect = z.infer<typeof PolicyEffect>;

export const PolicyRule = z.object({
  rule_id: Slug,
  action: ActionKind,
  effect: PolicyEffect,
  /** Omitted means the rule applies in every environment. */
  environments: z.array(Environment).optional(),
  release_categories: z.array(ReleaseCategory).optional(),
  tools: z.array(z.string().min(1)).optional(),
  /** For allow rules: requests estimated above this escalate instead of proceeding. */
  max_usd_cents_per_action: UsdCents.optional(),
  exception_owner: z.string().min(1),
  note: z.string().optional(),
});
export type PolicyRule = z.infer<typeof PolicyRule>;

/** Policy record from architecture.md §13. Anything not matched by a rule is denied. */
export const Policy = z.object({
  policy_id: Slug,
  version: Version,
  scope: z.discriminatedUnion("level", [
    z.object({ level: z.literal("portfolio") }),
    z.object({ level: z.literal("product"), product_id: Slug }),
  ]),
  rules: z.array(PolicyRule),
});
export type Policy = z.infer<typeof Policy>;

export const ActionRequest = z.object({
  request_id: z.string().min(1),
  action: ActionKind,
  environment: Environment,
  actor: z.object({
    role_version: RoleVersionRef,
    worker_id: z.string().min(1),
    product_id: Slug.optional(),
    run_id: Slug.optional(),
    task_id: Slug.optional(),
  }),
  tool: z.string().min(1).optional(),
  release_category: ReleaseCategory.optional(),
  estimated_usd_cents: UsdCents,
  idempotency_key: z.string().min(1),
});
export type ActionRequest = z.infer<typeof ActionRequest>;

export const PolicyDecision = z.object({
  effect: PolicyEffect,
  reason: z.string(),
  policy_id: Slug.optional(),
  policy_version: Version.optional(),
  rule_id: Slug.optional(),
  exception_owner: z.string().optional(),
});
export type PolicyDecision = z.infer<typeof PolicyDecision>;
