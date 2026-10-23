import { z } from "zod";
import { Slug, Timestamp } from "./common.js";

/** Evidence strength ladder from idea.md. Order matters: later stages imply stronger evidence. */
export const EVIDENCE_STAGES = ["discovered", "researched", "behavior_tested", "paid", "retained"] as const;
export const EvidenceStage = z.enum(EVIDENCE_STAGES);
export type EvidenceStage = z.infer<typeof EvidenceStage>;

export function stageAtLeast(stage: EvidenceStage, minimum: EvidenceStage): boolean {
  return EVIDENCE_STAGES.indexOf(stage) >= EVIDENCE_STAGES.indexOf(minimum);
}

export const SourceKind = z.enum([
  "public_discussion",
  "review",
  "competitor_product",
  "search_interest",
  "workaround",
  "interview",
  "experiment_result",
  "dataset",
  "other",
]);
export type SourceKind = z.infer<typeof SourceKind>;

export const EvidenceStance = z.enum(["supports", "contradicts", "context"]);
export type EvidenceStance = z.infer<typeof EvidenceStance>;

/**
 * One meaningful research finding with provenance. Excerpts are untrusted source
 * material: they are quoted, never executed or followed as instructions.
 */
export const EvidenceRecord = z.object({
  evidence_id: Slug,
  source: z.object({
    kind: SourceKind,
    uri: z.string().min(1),
    title: z.string().optional(),
  }),
  retrieved_at: Timestamp,
  published_at: Timestamp.optional(),
  excerpt: z.string().min(1).max(4000),
  audience_context: z.string().min(1),
  claim: z.string().min(1),
  stance: EvidenceStance,
  limitations: z.array(z.string().min(1)),
  /**
   * Opaque, non-reversible key for the contributor, used only to avoid counting
   * repeated contributions by the same person as independent evidence.
   */
  contributor_key: z.string().min(1).optional(),
  /** Records that are reposts or near-duplicates of each other share a cluster id. */
  duplicate_cluster_id: Slug.optional(),
  is_promotional: z.boolean(),
});
export type EvidenceRecord = z.infer<typeof EvidenceRecord>;

/**
 * Counts independent pieces of evidence for a stance. Promotional content is
 * excluded; records sharing a duplicate cluster or a contributor count once.
 */
export function countIndependentEvidence(records: readonly EvidenceRecord[], stance: EvidenceStance): number {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(x, root);
    return root;
  };
  const union = (a: string, b: string) => {
    for (const k of [a, b]) if (!parent.has(k)) parent.set(k, k);
    parent.set(find(a), find(b));
  };

  for (const r of records) {
    if (r.stance !== stance || r.is_promotional) continue;
    const self = `e:${r.evidence_id}`;
    union(self, self);
    if (r.duplicate_cluster_id) union(self, `d:${r.duplicate_cluster_id}`);
    if (r.contributor_key) union(self, `c:${r.contributor_key}`);
  }

  const roots = new Set<string>();
  for (const key of parent.keys()) if (key.startsWith("e:")) roots.add(find(key));
  return roots.size;
}
