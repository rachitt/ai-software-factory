import { z } from "zod";

/** Stable lowercase identifier: `language-coach`, `guest_progress_survives_registration`. */
export const Slug = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/, "must be a lowercase slug (letters, digits, - or _)");
export type Slug = z.infer<typeof Slug>;

/** Versioned role reference such as `frontend-builder-v2`. */
export const RoleVersionRef = z.string().regex(/^[a-z][a-z0-9-]*-v[0-9]+$/, "must look like <role-id>-v<n>");
export type RoleVersionRef = z.infer<typeof RoleVersionRef>;

export const Timestamp = z.iso.datetime({ offset: true });
export type Timestamp = z.infer<typeof Timestamp>;

/** Monotonic integer version for specifications, briefs, policies, and contracts. */
export const Version = z.number().int().positive();

/** Internal factory budgets and costs are tracked in integer US cents to avoid float drift. */
export const UsdCents = z.number().int().nonnegative();
export type UsdCents = z.infer<typeof UsdCents>;

export const GitCommit = z.string().regex(/^[0-9a-f]{6,64}$/, "must be a hex commit id");
export const Digest = z.string().regex(/^sha256:[0-9a-f]{64}$/, "must be a sha256 digest");

export const Confidence = z.enum(["low", "medium", "high"]);
export type Confidence = z.infer<typeof Confidence>;

/** Who made a decision. Agent-made decisions never imply authorization on their own. */
export const Actor = z.object({
  kind: z.enum(["agent", "human", "controller"]),
  id: z.string().min(1),
});
export type Actor = z.infer<typeof Actor>;

export const ArtifactRef = z.object({
  kind: z.enum(["commit", "build_artifact", "document", "design", "trace", "screenshot", "dataset", "report"]),
  uri: z.string().min(1),
  digest: Digest.optional(),
});
export type ArtifactRef = z.infer<typeof ArtifactRef>;

/** Returns the values that occur more than once, in first-seen order. */
export function duplicates<T>(values: readonly T[]): T[] {
  const seen = new Set<T>();
  const dupes = new Set<T>();
  for (const v of values) {
    if (seen.has(v)) dupes.add(v);
    seen.add(v);
  }
  return [...dupes];
}
