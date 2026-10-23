import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  countIndependentEvidence,
  Experiment,
  experimentResultProblems,
  InvestmentDecision,
  missingEvidence,
  OpportunityBrief,
  ProductSpecification,
  stageAtLeast,
  TaskContract,
  type ExperimentResult,
} from "./index.js";
import { evidence, NOW, opportunityBrief, productSpecification } from "./testing.js";

describe("TaskContract", () => {
  it("parses the example task contract in docs/architecture.md verbatim", () => {
    const doc = readFileSync(new URL("../../../docs/architecture.md", import.meta.url), "utf8");
    const yaml = doc.match(/```yaml\n(task_id:[\s\S]*?)```/)?.[1];
    expect(yaml).toBeDefined();
    const task = TaskContract.parse(parseYaml(yaml!));
    expect(task.task_id).toBe("onboarding-implementation");
    expect(task.limits.spend_budget).toBe("configured_per_run");
    expect(task.acceptance_criteria).toEqual(["guest_progress_survives_registration"]);
  });

  it("requires at least one allowed change path", () => {
    const result = TaskContract.safeParse({
      task_id: "t",
      product_id: "p",
      spec_version: 1,
      role_version: "frontend-builder-v1",
      allowed_changes: [],
      required_outputs: ["implementation_commit"],
      limits: { max_attempts: 1, spend_budget: 100 },
    });
    expect(result.success).toBe(false);
  });
});

describe("evidence", () => {
  it("orders evidence stages", () => {
    expect(stageAtLeast("paid", "behavior_tested")).toBe(true);
    expect(stageAtLeast("researched", "behavior_tested")).toBe(false);
  });

  it("does not count reposts, repeat contributors, or promotional content as independent", () => {
    const records = [
      evidence("a", { duplicate_cluster_id: "repost-1" }),
      evidence("b", { duplicate_cluster_id: "repost-1" }),
      evidence("c", { contributor_key: "u1" }),
      evidence("d", { contributor_key: "u1" }),
      evidence("e", { contributor_key: "u1", duplicate_cluster_id: "repost-2" }),
      evidence("f", { duplicate_cluster_id: "repost-2" }),
      evidence("g", { is_promotional: true }),
      evidence("h"),
      evidence("i", { stance: "contradicts" }),
    ];
    // {a,b}, {c,d,e,f} (linked through u1 and repost-2), {h}
    expect(countIndependentEvidence(records, "supports")).toBe(3);
    expect(countIndependentEvidence(records, "contradicts")).toBe(1);
  });
});

describe("OpportunityBrief", () => {
  it("accepts a complete brief", () => {
    expect(OpportunityBrief.parse(opportunityBrief()).opportunity_id).toBe("travel-vocab");
  });

  it("requires supporting evidence", () => {
    expect(OpportunityBrief.safeParse(opportunityBrief({ supporting_evidence_ids: [] })).success).toBe(false);
  });

  it("reports cited evidence that does not exist", () => {
    const known = ["ev-1", "ev-2", "ev-3"].map((id) => evidence(id));
    expect(missingEvidence(opportunityBrief(), known)).toEqual(["ev-4"]);
  });
});

describe("experiments", () => {
  const experiment = Experiment.parse({
    experiment_id: "landing-1",
    opportunity_id: "travel-vocab",
    version: 1,
    hypothesis: "At least 4% of visitors join the waitlist at $8/month",
    uncertainty_addressed: "Willingness to pay",
    method: "landing_page",
    audience: "Travel forum visitors",
    offer: "Trip-ready phrases for $8/month",
    channel: "Community post",
    measurement: { primary_metric: "waitlist_rate", success_threshold: ">= 0.04", minimum_sample: 300 },
    guardrails: ["No misleading claims"],
    budget_usd_cents: 15_000,
    stopping_conditions: ["Budget spent", "14 days elapsed"],
    required_authorizations: ["publish_content"],
  });

  const result = (overrides: Partial<ExperimentResult>): ExperimentResult => ({
    experiment_id: "landing-1",
    experiment_version: 1,
    participants: { real: 320, synthetic: 0 },
    primary_metric_value: 0.05,
    outcome: "success",
    sample_limitations: [],
    evidence_ids: [],
    spent_usd_cents: 12_000,
    concluded_at: NOW,
    ...overrides,
  });

  it("accepts a result that meets the predeclared sample", () => {
    expect(experimentResultProblems(experiment, result({}))).toEqual([]);
  });

  it("forces low-sample results to be inconclusive; synthetic users do not count", () => {
    const problems = experimentResultProblems(experiment, result({ participants: { real: 40, synthetic: 500 } }));
    expect(problems.join()).toMatch(/must be inconclusive/);
    expect(
      experimentResultProblems(experiment, result({ participants: { real: 40, synthetic: 0 }, outcome: "inconclusive" })),
    ).toEqual([]);
  });

  it("flags overspend", () => {
    expect(experimentResultProblems(experiment, result({ spent_usd_cents: 20_000 })).join()).toMatch(/budget/);
  });
});

describe("InvestmentDecision", () => {
  const base = {
    decision_id: "d1",
    opportunity_id: "travel-vocab",
    brief_version: 1,
    evidence_stage: "behavior_tested",
    max_investment_usd_cents: 100_000,
    decided_by: { kind: "human", id: "owner" },
    rationale: "Landing page beat threshold",
    decided_at: NOW,
  } as const;

  it("rejects a build decision without review and experiment", () => {
    expect(InvestmentDecision.safeParse({ ...base, decision: "build", experiment_ids: [] }).success).toBe(false);
  });

  it("accepts a build decision with review and experiment", () => {
    const parsed = InvestmentDecision.safeParse({
      ...base,
      decision: "build",
      review_id: "skeptic-1",
      experiment_ids: ["landing-1"],
    });
    expect(parsed.success).toBe(true);
  });
});

describe("ProductSpecification", () => {
  it("accepts a valid specification", () => {
    expect(ProductSpecification.parse(productSpecification()).requirements).toHaveLength(3);
  });

  it("rejects duplicate requirement and criterion ids", () => {
    const spec = productSpecification();
    const dup = { ...spec.requirements[0]!, statement: "copy" };
    const result = ProductSpecification.safeParse({ ...spec, requirements: [...spec.requirements, dup] });
    expect(result.success).toBe(false);
    const messages = result.error!.issues.map((i) => i.message).join("\n");
    expect(messages).toMatch(/duplicate requirement_id "guest-onboarding"/);
    expect(messages).toMatch(/duplicate criterion_id "guest_progress_survives_registration"/);
  });

  it("requires the commerce module for paid products and deletion support for all", () => {
    const spec = productSpecification({
      foundation_modules: ["identity"],
      data_handling: { personal_data: [], retention: "n/a", export_supported: false, deletion_supported: false },
    });
    const messages = ProductSpecification.safeParse(spec).error!.issues.map((i) => i.message);
    expect(messages).toContain("paid models require the commerce module");
    expect(messages).toContain("consumer products must support account deletion");
  });
});
