import { z } from "zod";
import { duplicates, Slug, Version } from "./common.js";

export const Platform = z.enum(["web", "ios", "android"]);
export type Platform = z.infer<typeof Platform>;

/** Verification areas from architecture.md §9. */
export const VerificationArea = z.enum([
  "functional",
  "access_control",
  "purchases",
  "experience",
  "reliability",
  "security_privacy",
  "operations",
  "ai_features",
]);
export type VerificationArea = z.infer<typeof VerificationArea>;

export const FoundationModule = z.enum([
  "identity",
  "consumer_experience",
  "commerce",
  "communication",
  "data_and_jobs",
  "trust_and_support",
  "product_measurement",
  "operations",
  "design_system",
]);
export type FoundationModule = z.infer<typeof FoundationModule>;

export const AcceptanceCriterion = z.object({
  criterion_id: Slug,
  given: z.string().min(1),
  when: z.string().min(1),
  then: z.string().min(1),
});
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterion>;

export const Requirement = z.object({
  requirement_id: Slug,
  statement: z.string().min(1),
  priority: z.enum(["must", "should", "could"]),
  verification_areas: z.array(VerificationArea).min(1),
  acceptance_criteria: z.array(AcceptanceCriterion).min(1),
});
export type Requirement = z.infer<typeof Requirement>;

/** Versioned product contract from architecture.md §4. */
export const ProductSpecification = z
  .object({
    product_id: Slug,
    spec_version: Version,
    category: Slug,
    platform: Platform,
    opportunity_id: Slug.optional(),

    audience: z.string().min(1),
    core_promise: z.string().min(1),
    primary_journey: z.array(z.object({ step_id: Slug, description: z.string().min(1) })).min(1),
    first_value_event: Slug,
    return_reason: z.string().min(1),

    entities: z.array(
      z.object({
        name: z.string().min(1),
        description: z.string().min(1),
        ownership: z.enum(["user_owned", "shared", "system"]),
      }),
    ),
    permissions: z.array(z.string().min(1)),
    integrations: z.array(z.object({ name: z.string().min(1), purpose: z.string().min(1) })),
    monetization: z.object({
      model: z.enum(["free", "subscription", "freemium_subscription", "one_time"]),
      plans: z.array(
        z.object({
          plan_id: Slug,
          price_minor: z.number().int().nonnegative(),
          currency: z.string().length(3),
          interval: z.enum(["month", "year", "once"]),
          trial_days: z.number().int().nonnegative().optional(),
        }),
      ),
    }),
    data_handling: z.object({
      personal_data: z.array(z.string().min(1)),
      retention: z.string().min(1),
      export_supported: z.boolean(),
      deletion_supported: z.boolean(),
    }),
    nonfunctional_targets: z.array(z.object({ target_id: Slug, statement: z.string().min(1) })),
    exclusions: z.array(z.string().min(1)),
    foundation_modules: z.array(FoundationModule),

    requirements: z.array(Requirement).min(1),
    /** Unresolved product questions stay explicit; blocking ones prevent planning. */
    open_questions: z.array(
      z.object({ question_id: Slug, question: z.string().min(1), blocking: z.boolean() }),
    ),
  })
  .superRefine((spec, ctx) => {
    for (const id of duplicates(spec.requirements.map((r) => r.requirement_id))) {
      ctx.addIssue({ code: "custom", path: ["requirements"], message: `duplicate requirement_id "${id}"` });
    }
    const criteria = spec.requirements.flatMap((r) => r.acceptance_criteria.map((c) => c.criterion_id));
    for (const id of duplicates(criteria)) {
      ctx.addIssue({ code: "custom", path: ["requirements"], message: `duplicate criterion_id "${id}"` });
    }
    const needsCommerce = spec.monetization.model !== "free";
    if (needsCommerce && spec.monetization.plans.length === 0) {
      ctx.addIssue({ code: "custom", path: ["monetization", "plans"], message: "paid models need at least one plan" });
    }
    if (needsCommerce && !spec.foundation_modules.includes("commerce")) {
      ctx.addIssue({ code: "custom", path: ["foundation_modules"], message: "paid models require the commerce module" });
    }
    if (!spec.data_handling.deletion_supported) {
      ctx.addIssue({ code: "custom", path: ["data_handling"], message: "consumer products must support account deletion" });
    }
  });
export type ProductSpecification = z.infer<typeof ProductSpecification>;

export function hasBlockingQuestions(spec: ProductSpecification): boolean {
  return spec.open_questions.some((q) => q.blocking);
}

/** Every acceptance criterion with its parent requirement, for traceability. */
export function allCriteria(spec: ProductSpecification): Array<{ requirement: Requirement; criterion: AcceptanceCriterion }> {
  return spec.requirements.flatMap((requirement) =>
    requirement.acceptance_criteria.map((criterion) => ({ requirement, criterion })),
  );
}
