import { z } from "zod";
import { ArtifactRef, GitCommit, RoleVersionRef, Slug, Timestamp, UsdCents, Version } from "./common.js";

/**
 * Bounded assignment contract from architecture.md §7. Field names match the
 * YAML example there so task files can be written by hand or by agents.
 */
export const TaskContract = z.object({
  task_id: Slug,
  product_id: Slug,
  spec_version: Version,
  role_version: RoleVersionRef,
  base_commit: GitCommit.optional(),
  description: z.string().min(1).optional(),
  inputs: z.array(ArtifactRef).default([]),
  /** Task ids or versioned contract refs that must complete first. */
  dependencies: z.array(z.string().min(1)).default([]),
  /** Glob patterns this worker may write. Writes outside are rejected by the integration queue. */
  allowed_changes: z.array(z.string().min(1)).min(1),
  required_outputs: z.array(Slug).min(1),
  /** Criterion ids from the specification this task must satisfy. */
  acceptance_criteria: z.array(Slug).default([]),
  escalation_conditions: z.array(z.string().min(1)).default([]),
  limits: z.object({
    max_attempts: z.number().int().positive(),
    spend_budget: z.union([UsdCents, z.literal("configured_per_run")]),
    timeout_minutes: z.number().int().positive().optional(),
  }),
});
export type TaskContract = z.infer<typeof TaskContract>;
export type TaskContractInput = z.input<typeof TaskContract>;

/** Why an attempt failed; drives the retry policy (architecture.md §6). */
export const FailureKind = z.enum([
  "transient_infrastructure",
  "implementation",
  "missing_information",
  "budget_exhausted",
  "policy_denied",
  "lease_expired",
]);
export type FailureKind = z.infer<typeof FailureKind>;

export const Lease = z.object({
  owner: z.string().min(1),
  acquired_at: Timestamp,
  heartbeat_at: Timestamp,
  expires_at: Timestamp,
});
export type Lease = z.infer<typeof Lease>;

export const AgentAttempt = z.object({
  attempt_id: Slug,
  task_id: Slug,
  attempt_number: z.number().int().positive(),
  worker_id: z.string().min(1),
  role_version: RoleVersionRef,
  status: z.enum(["running", "succeeded", "failed", "abandoned"]),
  failure_kind: FailureKind.optional(),
  failure_detail: z.string().optional(),
  outputs: z.array(ArtifactRef),
  cost_usd_cents: UsdCents,
  started_at: Timestamp,
  ended_at: Timestamp.optional(),
});
export type AgentAttempt = z.infer<typeof AgentAttempt>;
