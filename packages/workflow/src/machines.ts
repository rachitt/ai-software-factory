import {
  experimentResultProblems,
  hasBlockingQuestions,
  missingEvidence,
  stageAtLeast,
  type ActionKind,
  type EvidenceRecord,
  type Experiment,
  type ExperimentResult,
  type Finding,
  type InvestmentDecision,
  type OpportunityBrief,
  type PolicyDecision,
  type ProductSpecification,
  type SkepticReview,
  type TaskContract,
  type VerificationResult,
} from "@factory/contracts";
import { graphIsValid, validateGraph } from "./graph.js";
import { required, type MachineDef } from "./machine.js";
import { checkReleaseGate } from "./release-gate.js";

// ---------------------------------------------------------------- Opportunity

export type OpportunityState =
  | "discovered"
  | "researched"
  | "experiment_ready"
  | "experimenting"
  | "build_eligible"
  | "needs_more_evidence"
  | "rejected";

export interface OpportunityContext {
  brief?: OpportunityBrief;
  evidence?: readonly EvidenceRecord[];
  review?: SkepticReview;
  experiment?: Experiment;
  /** Actions the controller has confirmed are allowed by policy for this experiment. */
  authorized_actions?: readonly ActionKind[];
  results?: readonly ExperimentResult[];
  decision?: InvestmentDecision;
}

function decisionFor(ctx: OpportunityContext, expected: InvestmentDecision["decision"]): string[] {
  const p: string[] = [];
  if (!required(ctx.decision, "investment decision", p) || !required(ctx.brief, "brief", p)) return p;
  if (ctx.decision.decision !== expected) p.push(`investment decision is ${ctx.decision.decision}, not ${expected}`);
  if (ctx.decision.brief_version !== ctx.brief.version) p.push("investment decision references a stale brief version");
  return p;
}

export const opportunityMachine: MachineDef<OpportunityState, OpportunityContext> = {
  name: "opportunity",
  initial: "discovered",
  edges: {
    discovered: ["researched", "rejected"],
    researched: ["experiment_ready", "rejected"],
    experiment_ready: ["experimenting", "rejected"],
    experimenting: ["build_eligible", "needs_more_evidence", "rejected"],
    needs_more_evidence: ["researched", "experiment_ready", "rejected"],
    build_eligible: [],
    rejected: [],
  },
  guards: {
    researched: (ctx) => {
      const p: string[] = [];
      if (!required(ctx.brief, "brief", p) || !required(ctx.evidence, "evidence", p)) return p;
      if (!stageAtLeast(ctx.brief.evidence_stage, "researched")) p.push("brief evidence stage is below researched");
      const missing = missingEvidence(ctx.brief, ctx.evidence);
      if (missing.length) p.push(`brief cites unknown evidence: ${missing.join(", ")}`);
      return p;
    },
    experiment_ready: (ctx) => {
      const p: string[] = [];
      if (!required(ctx.brief, "brief", p)) return p;
      if (required(ctx.review, "independent skeptic review", p)) {
        if (ctx.review.opportunity_id !== ctx.brief.opportunity_id || ctx.review.brief_version !== ctx.brief.version) {
          p.push("skeptic review does not cover the current brief version");
        }
        if (ctx.review.recommendation === "reject") p.push("skeptic recommended rejection; a human decision is required");
      }
      if (required(ctx.experiment, "experiment", p) && ctx.experiment.budget_usd_cents > ctx.brief.next_investment_limit_usd_cents) {
        p.push("experiment budget exceeds the brief's next investment limit");
      }
      return p;
    },
    experimenting: (ctx) => {
      const p: string[] = [];
      if (!required(ctx.experiment, "experiment", p)) return p;
      const authorized = new Set(ctx.authorized_actions ?? []);
      for (const a of ctx.experiment.required_authorizations) {
        if (!authorized.has(a)) p.push(`experiment requires ${a} authorization`);
      }
      return p;
    },
    build_eligible: (ctx) => {
      const p = decisionFor(ctx, "build");
      if (required(ctx.experiment, "experiment", p) && required(ctx.results, "experiment results", p)) {
        const own = ctx.results.filter((r) => r.experiment_id === ctx.experiment!.experiment_id);
        if (own.length === 0) p.push("no results for the current experiment");
        for (const r of own) p.push(...experimentResultProblems(ctx.experiment, r));
      }
      return p;
    },
    needs_more_evidence: (ctx) => decisionFor(ctx, "investigate_further"),
    rejected: (ctx) => {
      const p: string[] = [];
      if (required(ctx.decision, "investment decision", p) && ctx.decision.decision !== "reject") {
        p.push(`investment decision is ${ctx.decision.decision}, not reject`);
      }
      return p;
    },
  },
};

// ---------------------------------------------------------------------- Build

export type BuildState =
  | "specified"
  | "planned"
  | "designing"
  | "implementing"
  | "verifying"
  | "release_eligible"
  | "releasing"
  | "operating";

export interface BuildContext {
  spec?: ProductSpecification;
  tasks?: readonly TaskContract[];
  /** Versioned artifacts outside the task graph that tasks may depend on. */
  external_refs?: ReadonlySet<string>;
  design_refs?: readonly string[];
  source_commit?: string;
  artifact_digest?: string;
  verification_results?: readonly VerificationResult[];
  findings?: readonly Finding[];
  release_policy_decision?: PolicyDecision;
  deployment_ref?: string;
}

function releaseGate(ctx: BuildContext): string[] {
  const p: string[] = [];
  if (
    !required(ctx.spec, "specification", p) ||
    !required(ctx.source_commit, "source commit", p) ||
    !required(ctx.artifact_digest, "artifact digest", p)
  ) {
    return p;
  }
  return checkReleaseGate({
    spec: ctx.spec,
    source_commit: ctx.source_commit,
    artifact_digest: ctx.artifact_digest,
    results: ctx.verification_results ?? [],
    findings: ctx.findings ?? [],
  }).problems;
}

function candidateBuilt(ctx: BuildContext): string[] {
  const p: string[] = [];
  required(ctx.source_commit, "source commit", p);
  required(ctx.artifact_digest, "artifact digest", p);
  return p;
}

function releaseAuthorized(ctx: BuildContext): string[] {
  const p: string[] = [];
  if (required(ctx.release_policy_decision, "release policy decision", p) && ctx.release_policy_decision.effect !== "allow") {
    p.push(`release policy decision is ${ctx.release_policy_decision.effect}: ${ctx.release_policy_decision.reason}`);
  }
  return p;
}

export const buildMachine: MachineDef<BuildState, BuildContext> = {
  name: "build",
  initial: "specified",
  edges: {
    specified: ["planned"],
    planned: ["designing", "implementing"],
    designing: ["implementing"],
    implementing: ["verifying"],
    // Findings send the build back to implementation.
    verifying: ["release_eligible", "implementing"],
    release_eligible: ["releasing", "implementing"],
    releasing: ["operating"],
    operating: [],
  },
  guards: {
    planned: (ctx) => {
      const p: string[] = [];
      if (!required(ctx.spec, "specification", p) || !required(ctx.tasks, "task graph", p)) return p;
      if (hasBlockingQuestions(ctx.spec)) p.push("specification has blocking open questions");
      if (ctx.tasks.length === 0) p.push("task graph is empty");
      const graph = validateGraph(ctx.tasks, ctx.external_refs);
      if (!graphIsValid(graph)) p.push(`invalid task graph: ${JSON.stringify(graph)}`);
      const criteria = new Set(ctx.spec.requirements.flatMap((r) => r.acceptance_criteria.map((c) => c.criterion_id)));
      for (const t of ctx.tasks) {
        if (t.spec_version !== ctx.spec.spec_version) p.push(`task ${t.task_id} targets spec v${t.spec_version}`);
        for (const c of t.acceptance_criteria) if (!criteria.has(c)) p.push(`task ${t.task_id} cites unknown criterion ${c}`);
      }
      return p;
    },
    implementing: (ctx) => {
      const p: string[] = [];
      if (required(ctx.design_refs, "design artifacts", p) && ctx.design_refs.length === 0) p.push("design artifacts are empty");
      return p;
    },
    verifying: candidateBuilt,
    release_eligible: releaseGate,
    releasing: (ctx) => [...releaseGate(ctx), ...releaseAuthorized(ctx)],
    operating: (ctx) => {
      const p: string[] = [];
      required(ctx.deployment_ref, "deployment reference", p);
      return p;
    },
  },
};

// --------------------------------------------------------------------- Repair

export type RepairState = "detected" | "reproduced" | "implementing" | "verifying" | "release_eligible";

export interface RepairContext extends BuildContext {
  reproduction?: string;
  regression_test_ref?: string;
}

export const repairMachine: MachineDef<RepairState, RepairContext> = {
  name: "repair",
  initial: "detected",
  edges: {
    detected: ["reproduced"],
    reproduced: ["implementing"],
    implementing: ["verifying"],
    verifying: ["release_eligible", "implementing"],
    release_eligible: [],
  },
  guards: {
    reproduced: (ctx) => {
      const p: string[] = [];
      required(ctx.reproduction, "reproduction", p);
      required(ctx.regression_test_ref, "regression test", p);
      return p;
    },
    verifying: candidateBuilt,
    release_eligible: releaseGate,
  },
};
