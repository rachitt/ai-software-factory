import { z } from "zod";
import { Actor, Confidence, RoleVersionRef, Slug, Timestamp, UsdCents, Version } from "./common.js";
import { EvidenceStage, type EvidenceRecord } from "./evidence.js";

const EvidenceIds = z.array(Slug);

const EvidencedClaim = z.object({
  description: z.string().min(1),
  evidence_ids: EvidenceIds,
});

/** Opportunity contract from architecture.md §3.2. */
export const OpportunityBrief = z.object({
  opportunity_id: Slug,
  version: Version,
  category: Slug,

  audience: z.string().min(1),
  triggering_situation: z.string().min(1),
  problem: z.string().min(1),
  current_workaround: EvidencedClaim,
  frequency: EvidencedClaim,
  severity: z.object({
    time: z.string().optional(),
    money: z.string().optional(),
    frustration: z.string().optional(),
    evidence_ids: EvidenceIds,
  }),

  alternatives: z.array(
    z.object({
      name: z.string().min(1),
      kind: z.enum(["competitor", "substitute", "workaround"]),
      pricing: z.string().optional(),
      shortcomings: z.string().optional(),
      evidence_ids: EvidenceIds,
    }),
  ),
  existing_spending: EvidencedClaim,

  proposed_promise: z.string().min(1),
  differentiation: z.string().min(1),
  switching_hypothesis: z.string().min(1),

  acquisition_route: z.object({
    channel: z.string().min(1),
    rationale: z.string().min(1),
  }),
  economic_assumptions: z.array(
    z.object({
      assumption: z.string().min(1),
      confidence: Confidence,
      evidence_ids: EvidenceIds,
    }),
  ),

  supporting_evidence_ids: EvidenceIds.min(1),
  contradicting_evidence_ids: EvidenceIds,
  open_uncertainties: z.array(z.string().min(1)),

  evidence_stage: EvidenceStage,
  /** Attractiveness and evidence confidence are rated separately on purpose. */
  attractiveness: z.object({ score: z.number().int().min(1).max(5), rationale: z.string().min(1) }),
  confidence: z.object({ level: Confidence, rationale: z.string().min(1) }),

  next_experiment_id: Slug.optional(),
  next_investment_limit_usd_cents: UsdCents,
});
export type OpportunityBrief = z.infer<typeof OpportunityBrief>;

/** Every evidence id cited by a brief, in first-seen order. */
export function citedEvidenceIds(brief: OpportunityBrief): string[] {
  const ids = [
    ...brief.current_workaround.evidence_ids,
    ...brief.frequency.evidence_ids,
    ...brief.severity.evidence_ids,
    ...brief.alternatives.flatMap((a) => a.evidence_ids),
    ...brief.existing_spending.evidence_ids,
    ...brief.economic_assumptions.flatMap((a) => a.evidence_ids),
    ...brief.supporting_evidence_ids,
    ...brief.contradicting_evidence_ids,
  ];
  return [...new Set(ids)];
}

/** Returns cited evidence ids that do not exist in the evidence store. Claims must carry provenance. */
export function missingEvidence(brief: OpportunityBrief, evidence: readonly EvidenceRecord[]): string[] {
  const known = new Set(evidence.map((e) => e.evidence_id));
  return citedEvidenceIds(brief).filter((id) => !known.has(id));
}

/** Independent demand skeptic output (architecture.md §3.2). */
export const SkepticReview = z.object({
  review_id: Slug,
  opportunity_id: Slug,
  brief_version: Version,
  reviewer_role_version: RoleVersionRef,
  failure_modes: z
    .array(
      z.object({
        description: z.string().min(1),
        severity: z.enum(["minor", "major", "fatal"]),
        evidence_ids: EvidenceIds,
      }),
    )
    .min(1, "a skeptic must name at least one way the idea could fail"),
  assumption_challenges: z.array(
    z.object({
      assumption: z.string().min(1),
      challenge: z.string().min(1),
      verdict: z.enum(["holds", "weakened", "refuted", "untested"]),
    }),
  ),
  /** Evidence the skeptic found through its own searches. */
  additional_evidence_ids: EvidenceIds,
  recommendation: z.enum(["proceed", "investigate_further", "reject"]),
  rationale: z.string().min(1),
  reviewed_at: Timestamp,
});
export type SkepticReview = z.infer<typeof SkepticReview>;

export const ExperimentMethod = z.enum([
  "interviews",
  "landing_page",
  "interactive_prototype",
  "manual_service",
  "paid_pilot",
  "limited_product",
]);

/** Gated external actions an experiment may need; each requires configured authorization. */
export const ExperimentAuthorization = z.enum([
  "publish_content",
  "send_communication",
  "spend_money",
  "accept_payment",
]);

/** Experiments are defined fully before execution (idea.md "Evidence stages"). */
export const Experiment = z.object({
  experiment_id: Slug,
  opportunity_id: Slug,
  version: Version,
  hypothesis: z.string().min(1),
  uncertainty_addressed: z.string().min(1),
  method: ExperimentMethod,
  audience: z.string().min(1),
  offer: z.string().min(1),
  channel: z.string().min(1),
  measurement: z.object({
    primary_metric: z.string().min(1),
    success_threshold: z.string().min(1),
    minimum_sample: z.number().int().positive(),
  }),
  guardrails: z.array(z.string().min(1)),
  budget_usd_cents: UsdCents,
  stopping_conditions: z.array(z.string().min(1)).min(1),
  required_authorizations: z.array(ExperimentAuthorization),
});
export type Experiment = z.infer<typeof Experiment>;

export const ExperimentResult = z
  .object({
    experiment_id: Slug,
    experiment_version: Version,
    participants: z.object({
      real: z.number().int().nonnegative(),
      /** Synthetic users may exercise instrumentation but never count as demand. */
      synthetic: z.number().int().nonnegative(),
    }),
    primary_metric_value: z.number(),
    outcome: z.enum(["success", "failure", "inconclusive"]),
    sample_limitations: z.array(z.string().min(1)),
    evidence_ids: EvidenceIds,
    spent_usd_cents: UsdCents,
    concluded_at: Timestamp,
  });
export type ExperimentResult = z.infer<typeof ExperimentResult>;

/**
 * Checks a result against its experiment's predeclared rules. Results below
 * the minimum real sample must be inconclusive rather than fabricated certainty.
 */
export function experimentResultProblems(experiment: Experiment, result: ExperimentResult): string[] {
  const problems: string[] = [];
  if (result.experiment_id !== experiment.experiment_id || result.experiment_version !== experiment.version) {
    problems.push("result does not reference this experiment version");
  }
  if (result.participants.real < experiment.measurement.minimum_sample && result.outcome !== "inconclusive") {
    problems.push(
      `only ${result.participants.real} real participants (minimum ${experiment.measurement.minimum_sample}); outcome must be inconclusive`,
    );
  }
  if (result.spent_usd_cents > experiment.budget_usd_cents) {
    problems.push("experiment spent more than its declared budget");
  }
  return problems;
}

export const InvestmentDecision = z
  .object({
    decision_id: Slug,
    opportunity_id: Slug,
    brief_version: Version,
    decision: z.enum(["build", "investigate_further", "reject"]),
    evidence_stage: EvidenceStage,
    review_id: Slug.optional(),
    experiment_ids: z.array(Slug),
    max_investment_usd_cents: UsdCents,
    decided_by: Actor,
    rationale: z.string().min(1),
    decided_at: Timestamp,
  })
  .refine((d) => d.decision !== "build" || (d.review_id !== undefined && d.experiment_ids.length > 0), {
    message: "a build decision requires an independent review and at least one experiment",
    path: ["decision"],
  });
export type InvestmentDecision = z.infer<typeof InvestmentDecision>;
