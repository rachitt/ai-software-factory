import { z } from "zod";
import { Slug, UsdCents, Version } from "./common.js";
import { ActionKind } from "./policy.js";

export const Team = z.enum([
  "product_coordination",
  "discovery",
  "experience",
  "engineering",
  "assurance",
  "growth",
  "operations",
]);
export type Team = z.infer<typeof Team>;

/** Catalog entry: what a role is for. Full definitions are versioned separately. */
export const RoleCatalogEntry = z.object({
  role_id: Slug,
  team: Team,
  title: z.string().min(1),
  purpose: z.string().min(1),
  primary_outputs: z.array(z.string().min(1)).min(1),
  /** Whether this role is in the small active subset used for early milestones. */
  active: z.boolean(),
  /** Assurance roles must never also hold a builder role on the same task. */
  independent: z.boolean().default(false),
});
export type RoleCatalogEntry = z.infer<typeof RoleCatalogEntry>;

export const RoleCatalog = z.object({
  catalog_version: Version,
  roles: z.array(RoleCatalogEntry),
});
export type RoleCatalog = z.infer<typeof RoleCatalog>;

/** Versioned role definition from architecture.md §2. */
export const RoleDefinition = z.object({
  role_id: Slug,
  version: Version,
  instructions_ref: z.string().min(1),
  permitted_actions: z.array(ActionKind),
  permitted_tools: z.array(z.string().min(1)),
  context_rules: z.array(z.string().min(1)),
  output_schema: z.string().min(1),
  evaluation_rubric_ref: z.string().min(1),
  limits: z.object({
    max_tokens_per_attempt: z.number().int().positive(),
    max_usd_cents_per_attempt: UsdCents,
    max_wall_minutes: z.number().int().positive(),
  }),
});
export type RoleDefinition = z.infer<typeof RoleDefinition>;
