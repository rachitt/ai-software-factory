import { z } from "zod";
import {
  ActionKind,
  EvidenceRecord,
  Experiment,
  ExperimentResult,
  OpportunityBrief,
  SkepticReview,
  Slug,
  Timestamp,
  UsdCents,
  Version,
} from "@factory/contracts";
import type { OpportunityState } from "@factory/workflow";

/**
 * Tool inputs. The server assigns ids, versions, and timestamps so parallel
 * agents never collide, and records the calling role from `actor_role`, which
 * the PreToolUse hook checks against the subagent Claude Code reports.
 */
export const ActorRole = z
  .string()
  .min(1)
  .describe('Your role: your subagent name (e.g. "demand-skeptic"), or "controller" in the main session.');

export const EvidenceInput = EvidenceRecord.omit({ evidence_id: true, retrieved_at: true }).extend({
  retrieved_at: Timestamp.optional().describe("Defaults to now."),
});
export type EvidenceInput = z.infer<typeof EvidenceInput>;

export const BriefInput = OpportunityBrief.omit({ version: true });
export type BriefInput = z.infer<typeof BriefInput>;

export const ReviewInput = SkepticReview.omit({ review_id: true, reviewer_role_version: true, reviewed_at: true });
export type ReviewInput = z.infer<typeof ReviewInput>;

export const ExperimentInput = Experiment.omit({ version: true });
export type ExperimentInput = z.infer<typeof ExperimentInput>;

export const ExperimentResultInput = ExperimentResult.omit({ experiment_version: true, concluded_at: true }).extend({
  experiment_version: Version.optional().describe("Defaults to the latest version."),
  concluded_at: Timestamp.optional().describe("Defaults to now."),
});
export type ExperimentResultInput = z.infer<typeof ExperimentResultInput>;

export const DecisionInput = z.object({
  opportunity_id: Slug,
  decision: z.enum(["build", "investigate_further", "reject"]),
  rationale: z.string().min(1),
  max_investment_usd_cents: UsdCents,
});
export type DecisionInput = z.infer<typeof DecisionInput>;

export const AuthorizeInput = z.object({
  experiment_id: Slug,
  actions: z.array(ActionKind).describe("Must equal the experiment's required_authorizations."),
  budget_usd_cents: UsdCents.describe("Must equal the experiment's budget."),
});
export type AuthorizeInput = z.infer<typeof AuthorizeInput>;

export const OPPORTUNITY_TARGETS = [
  "researched",
  "experiment_ready",
  "experimenting",
  "build_eligible",
  "needs_more_evidence",
  "rejected",
] as const satisfies readonly OpportunityState[];

/** Schemas agents can fetch to see exactly what a submission must contain. */
export const CONTRACT_SCHEMAS = {
  evidence: EvidenceInput,
  brief: BriefInput,
  review: ReviewInput,
  experiment: ExperimentInput,
  experiment_result: ExperimentResultInput,
  decision: DecisionInput,
} as const;
export type ContractName = keyof typeof CONTRACT_SCHEMAS;
