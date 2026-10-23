import { z } from "zod";
import { Actor, ArtifactRef, Digest, GitCommit, Slug, Timestamp, Version } from "./common.js";
import { PolicyDecision, ReleaseCategory } from "./policy.js";
import { VerificationArea } from "./specification.js";

/** A check result bound to the exact source revision and artifact it ran against. */
export const VerificationResult = z.object({
  result_id: Slug,
  product_id: Slug,
  spec_version: Version,
  criterion_id: Slug,
  area: VerificationArea,
  source_commit: GitCommit,
  artifact_digest: Digest,
  status: z.enum(["passed", "failed", "error", "skipped"]),
  evidence: z.array(ArtifactRef),
  verifier_role_version: z.string().min(1),
  ran_at: Timestamp,
});
export type VerificationResult = z.infer<typeof VerificationResult>;

/** Reproducible finding from verification or operations (architecture.md §9). */
export const Finding = z.object({
  finding_id: Slug,
  product_id: Slug,
  severity: z.enum(["low", "medium", "high", "critical"]),
  area: VerificationArea,
  requirement_ids: z.array(Slug),
  source_commit: GitCommit,
  artifact_digest: Digest.optional(),
  summary: z.string().min(1),
  reproduction: z.string().min(1),
  status: z.enum(["open", "fixed", "accepted_risk", "invalid"]),
});
export type Finding = z.infer<typeof Finding>;

/** Immutable release manifest from architecture.md §10. */
export const ReleaseManifest = z.object({
  release_id: Slug,
  product_id: Slug,
  spec_version: Version,
  source_commit: GitCommit,
  artifact_digest: Digest,
  foundation_versions: z.record(z.string(), z.string()),
  release_category: ReleaseCategory,
  verification_result_ids: z.array(Slug).min(1),
  migration_plan: z.object({
    has_migrations: z.boolean(),
    backward_compatible: z.boolean(),
    destructive: z.boolean(),
    recovery_procedure: z.string().optional(),
  }),
  configuration_refs: z.array(z.string().min(1)),
  recovery_strategy: z.string().min(1),
  policy_decision: PolicyDecision,
  created_by: Actor,
  created_at: Timestamp,
});
export type ReleaseManifest = z.infer<typeof ReleaseManifest>;
