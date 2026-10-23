import {
  EvidenceRecord,
  Experiment,
  ExperimentResult,
  experimentResultProblems,
  InvestmentDecision,
  missingEvidence,
  OpportunityBrief,
  SkepticReview,
  type ActionKind,
  type PolicyDecision,
} from "@factory/contracts";
import { WorkflowStore, type Db, type Queryable } from "@factory/control-plane";
import { CONTROLLER_ROLE, NO_USAGE, type FactoryConfig, type StatusSnapshot, type UsageTotals } from "@factory/harness";
import { evaluate } from "@factory/policy";
import { opportunityMachine, type OpportunityContext, type OpportunityState } from "@factory/workflow";
import {
  BriefInput,
  DecisionInput,
  EvidenceInput,
  ExperimentInput,
  ExperimentResultInput,
  ReviewInput,
  type AuthorizeInput,
} from "./inputs.js";

/** A rejected request; the message is returned to the calling agent verbatim. */
export class FactoryError extends Error {}

/** Which roles may produce each kind of record. Independence is enforced here, not in prompts. */
export const ROLE_GRANTS = {
  opportunity_create: ["demand-intelligence-lead", CONTROLLER_ROLE],
  evidence_add: [
    "demand-intelligence-lead",
    "problem-evidence-analyst",
    "audience-researcher",
    "competitor-pricing-researcher",
    "demand-skeptic",
  ],
  brief_submit: ["demand-intelligence-lead"],
  review_submit: ["demand-skeptic"],
  experiment_define: ["experiment-designer"],
  experiment_result_record: ["experiment-designer"],
  experiment_authorize: [CONTROLLER_ROLE],
  decision_record: [CONTROLLER_ROLE],
  opportunity_advance: [CONTROLLER_ROLE],
  run_control: [CONTROLLER_ROLE],
} as const satisfies Record<string, readonly string[]>;
export type Grant = keyof typeof ROLE_GRANTS;

export interface ServiceOptions {
  db: Db;
  /** Read on every use so owner edits to .factory/config.yaml apply without a restart. */
  config: () => FactoryConfig;
  now?: () => string;
  usage?: () => UsageTotals;
  /** Called after every successful write, e.g. to refresh the status snapshot. */
  onChange?: () => void | Promise<void>;
}

const runId = (opportunityId: string) => `opp-${opportunityId}`;
const json = (v: unknown) => JSON.stringify(v);

export class FactoryService {
  private readonly db: Db;
  private readonly runs: WorkflowStore;
  private readonly now: () => string;

  constructor(private readonly opts: ServiceOptions) {
    this.db = opts.db;
    this.runs = new WorkflowStore(opts.db);
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  private authorize(grant: Grant, role: string): void {
    const allowed: readonly string[] = ROLE_GRANTS[grant];
    if (!allowed.includes(role)) {
      throw new FactoryError(`role "${role}" may not ${grant.replaceAll("_", " ")}; allowed: ${allowed.join(", ")}`);
    }
  }

  private async changed(): Promise<void> {
    await this.opts.onChange?.();
  }

  private async nextId(prefix: string, seq = "record_number_seq"): Promise<string> {
    const { rows } = await this.db.query<{ n: number }>(`SELECT nextval('${seq}')::int AS n`);
    return `${prefix}-${rows[0]!.n}`;
  }

  private async requireOpportunity(id: string, q: Queryable = this.db): Promise<{ category: string }> {
    const { rows } = await q.query<{ category: string }>("SELECT category FROM opportunities WHERE opportunity_id = $1", [id]);
    if (!rows[0]) throw new FactoryError(`unknown opportunity "${id}"; create it first`);
    return rows[0];
  }

  // ------------------------------------------------------------- Discovery

  async createOpportunity(input: { opportunity_id: string; category: string }, role: string) {
    this.authorize("opportunity_create", role);
    await this.db.query(
      "INSERT INTO opportunities (opportunity_id, category) VALUES ($1, $2) ON CONFLICT (opportunity_id) DO NOTHING",
      [input.opportunity_id, input.category],
    );
    const existing = await this.requireOpportunity(input.opportunity_id);
    if (existing.category !== input.category) {
      throw new FactoryError(`opportunity "${input.opportunity_id}" already exists in category "${existing.category}"`);
    }
    const run = await this.runs.create(opportunityMachine, runId(input.opportunity_id), input.opportunity_id);
    await this.changed();
    return { opportunity_id: input.opportunity_id, state: run.state };
  }

  /** Adds evidence with server-assigned ids. A record with the same source and excerpt is not stored twice. */
  async addEvidence(opportunityId: string, inputs: EvidenceInput[], role: string) {
    this.authorize("evidence_add", role);
    await this.requireOpportunity(opportunityId);
    const results: Array<{ evidence_id: string; status: "added" | "already_recorded" }> = [];
    for (const raw of inputs) {
      const input = EvidenceInput.parse(raw);
      const { rows: dup } = await this.db.query<{ evidence_id: string }>(
        "SELECT evidence_id FROM evidence WHERE opportunity_id = $1 AND source_uri = $2 AND body->>'excerpt' = $3",
        [opportunityId, input.source.uri, input.excerpt],
      );
      if (dup[0]) {
        results.push({ evidence_id: dup[0].evidence_id, status: "already_recorded" });
        continue;
      }
      const record = EvidenceRecord.parse({
        ...input,
        evidence_id: await this.nextId("ev", "evidence_number_seq"),
        retrieved_at: input.retrieved_at ?? this.now(),
      });
      await this.db.query(
        `INSERT INTO evidence (evidence_id, opportunity_id, source_kind, source_uri, retrieved_at, published_at, stance,
           duplicate_cluster_id, contributor_key, is_promotional, body, submitted_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)`,
        [
          record.evidence_id,
          opportunityId,
          record.source.kind,
          record.source.uri,
          record.retrieved_at,
          record.published_at ?? null,
          record.stance,
          record.duplicate_cluster_id ?? null,
          record.contributor_key ?? null,
          record.is_promotional,
          json(record),
          role,
        ],
      );
      results.push({ evidence_id: record.evidence_id, status: "added" });
    }
    await this.changed();
    return results;
  }

  async submitBrief(raw: BriefInput, role: string) {
    this.authorize("brief_submit", role);
    const input = BriefInput.parse(raw);
    const { category } = await this.requireOpportunity(input.opportunity_id);
    if (category !== input.category) throw new FactoryError(`brief category must be "${category}"`);
    const latest = await this.latestBrief(input.opportunity_id);
    const brief = OpportunityBrief.parse({ ...input, version: (latest?.version ?? 0) + 1 });
    const missing = missingEvidence(brief, await this.evidenceFor(brief.opportunity_id));
    if (missing.length) throw new FactoryError(`brief cites evidence that is not recorded: ${missing.join(", ")}`);
    await this.db.query(
      `INSERT INTO opportunity_briefs (opportunity_id, version, evidence_stage, body, submitted_by)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [brief.opportunity_id, brief.version, brief.evidence_stage, json(brief), role],
    );
    await this.changed();
    return { opportunity_id: brief.opportunity_id, version: brief.version };
  }

  async submitReview(raw: ReviewInput, role: string) {
    this.authorize("review_submit", role);
    const input = ReviewInput.parse(raw);
    const { rows } = await this.db.query<{ submitted_by: string }>(
      "SELECT submitted_by FROM opportunity_briefs WHERE opportunity_id = $1 AND version = $2",
      [input.opportunity_id, input.brief_version],
    );
    if (!rows[0]) throw new FactoryError(`no brief v${input.brief_version} for "${input.opportunity_id}"`);
    if (rows[0].submitted_by === role) throw new FactoryError("a brief's author cannot review it");
    const known = new Set((await this.evidenceFor(input.opportunity_id)).map((e) => e.evidence_id));
    const cited = [...input.additional_evidence_ids, ...input.failure_modes.flatMap((f) => f.evidence_ids)];
    const unknown = cited.filter((id) => !known.has(id));
    if (unknown.length) throw new FactoryError(`review cites evidence that is not recorded: ${unknown.join(", ")}`);
    const review = SkepticReview.parse({
      ...input,
      review_id: await this.nextId(`${input.opportunity_id}-review`),
      reviewer_role_version: `${role}-v1`,
      reviewed_at: this.now(),
    });
    await this.db.query(
      `INSERT INTO skeptic_reviews (review_id, opportunity_id, brief_version, recommendation, body, submitted_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [review.review_id, review.opportunity_id, review.brief_version, review.recommendation, json(review), role],
    );
    await this.changed();
    return { review_id: review.review_id };
  }

  async defineExperiment(raw: ExperimentInput, role: string) {
    this.authorize("experiment_define", role);
    const input = ExperimentInput.parse(raw);
    await this.requireOpportunity(input.opportunity_id);
    const { rows } = await this.db.query<{ opportunity_id: string; version: number }>(
      "SELECT opportunity_id, version FROM experiments WHERE experiment_id = $1 ORDER BY version DESC LIMIT 1",
      [input.experiment_id],
    );
    if (rows[0] && rows[0].opportunity_id !== input.opportunity_id) {
      throw new FactoryError(`experiment id "${input.experiment_id}" belongs to another opportunity`);
    }
    const experiment = Experiment.parse({ ...input, version: (rows[0]?.version ?? 0) + 1 });
    await this.db.query(
      `INSERT INTO experiments (experiment_id, version, opportunity_id, budget_usd_cents, body, submitted_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [experiment.experiment_id, experiment.version, experiment.opportunity_id, experiment.budget_usd_cents, json(experiment), role],
    );
    await this.changed();
    return { experiment_id: experiment.experiment_id, version: experiment.version };
  }

  /**
   * Records which gated actions an experiment may take. The PreToolUse hook
   * has already evaluated the same policy: denials never reach here, and
   * escalations only arrive after the owner approved the permission prompt.
   */
  async authorizeExperiment(input: AuthorizeInput, role: string) {
    this.authorize("experiment_authorize", role);
    const experiment = await this.latestExperiment(input.experiment_id);
    if (!experiment) throw new FactoryError(`unknown experiment "${input.experiment_id}"`);
    const required = [...experiment.required_authorizations].sort();
    if (json([...input.actions].sort()) !== json(required) || input.budget_usd_cents !== experiment.budget_usd_cents) {
      throw new FactoryError(
        `actions and budget must match experiment v${experiment.version}: actions ${json(required)}, budget ${experiment.budget_usd_cents}`,
      );
    }
    const granted: Array<{ action: ActionKind; via: "policy" | "owner_approval" }> = [];
    for (const action of experiment.required_authorizations) {
      const decision: PolicyDecision = evaluate(this.opts.config().policies, {
        request_id: `${experiment.experiment_id}-v${experiment.version}-${action}`,
        action,
        environment: "production",
        actor: { role_version: `${role}-v1`, worker_id: role },
        estimated_usd_cents: experiment.budget_usd_cents,
        idempotency_key: `${experiment.experiment_id}-v${experiment.version}-${action}`,
      });
      if (decision.effect === "deny") throw new FactoryError(`policy denies ${action}: ${decision.reason}`);
      const via = decision.effect === "allow" ? "policy" : "owner_approval";
      await this.db.query(
        `INSERT INTO experiment_authorizations (experiment_id, experiment_version, action, via, policy_decision)
         VALUES ($1, $2, $3, $4, $5::jsonb) ON CONFLICT DO NOTHING`,
        [experiment.experiment_id, experiment.version, action, via, json(decision)],
      );
      granted.push({ action, via });
    }
    await this.changed();
    return { experiment_id: experiment.experiment_id, version: experiment.version, granted };
  }

  async recordExperimentResult(raw: ExperimentResultInput, role: string) {
    this.authorize("experiment_result_record", role);
    const input = ExperimentResultInput.parse(raw);
    const experiment = await this.latestExperiment(input.experiment_id, input.experiment_version);
    if (!experiment) throw new FactoryError(`unknown experiment "${input.experiment_id}"`);
    const result = ExperimentResult.parse({
      ...input,
      experiment_version: experiment.version,
      concluded_at: input.concluded_at ?? this.now(),
    });
    const problems = experimentResultProblems(experiment, result);
    if (problems.length) throw new FactoryError(problems.join("; "));
    await this.db.query(
      `INSERT INTO experiment_results (experiment_id, experiment_version, outcome, body, concluded_at, submitted_by)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
      [result.experiment_id, result.experiment_version, result.outcome, json(result), result.concluded_at, role],
    );
    await this.changed();
    return { experiment_id: result.experiment_id, experiment_version: result.experiment_version, outcome: result.outcome };
  }

  /** Build decisions are escalated to the owner by policy before this runs. */
  async recordDecision(raw: DecisionInput, role: string) {
    this.authorize("decision_record", role);
    const input = DecisionInput.parse(raw);
    await this.requireOpportunity(input.opportunity_id);
    const brief = await this.latestBrief(input.opportunity_id);
    if (!brief) throw new FactoryError("record a brief before deciding");
    const review = await this.latestReview(input.opportunity_id, brief.version);
    const experiments = await this.db.query<{ experiment_id: string }>(
      `SELECT DISTINCT r.experiment_id FROM experiment_results r
       JOIN experiments e ON e.experiment_id = r.experiment_id AND e.version = r.experiment_version
       WHERE e.opportunity_id = $1 ORDER BY 1`,
      [input.opportunity_id],
    );
    const parsed = InvestmentDecision.safeParse({
      ...input,
      decision_id: await this.nextId(`${input.opportunity_id}-decision`),
      brief_version: brief.version,
      evidence_stage: brief.evidence_stage,
      ...(review && { review_id: review.review_id }),
      experiment_ids: experiments.rows.map((r) => r.experiment_id),
      decided_by: { kind: "human", id: "owner" },
      decided_at: this.now(),
    });
    if (!parsed.success) throw new FactoryError(parsed.error.issues.map((i) => i.message).join("; "));
    const decision = parsed.data;
    await this.db.query(
      `INSERT INTO investment_decisions (decision_id, opportunity_id, decision, body, decided_at, submitted_by)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
      [decision.decision_id, decision.opportunity_id, decision.decision, json(decision), decision.decided_at, role],
    );
    await this.changed();
    return { decision_id: decision.decision_id, decision: decision.decision };
  }

  // ------------------------------------------------------------- Workflow

  /** Advances an opportunity. Guards read stored records only; callers cannot supply evidence. */
  async advanceOpportunity(opportunityId: string, to: OpportunityState, role: string, reason?: string) {
    this.authorize("opportunity_advance", role);
    await this.requireOpportunity(opportunityId);
    const ctx = await this.contextFor(opportunityId);
    const run = await this.runs.get(runId(opportunityId));
    const key = `${runId(opportunityId)}:${run?.seq ?? 0}:${to}`;
    const result = await this.runs.apply(opportunityMachine, runId(opportunityId), { type: "advance", to, ctx }, key);
    if (result.status === "rejected") {
      throw new FactoryError(`cannot move ${opportunityId} to ${to}: ${result.problems.join("; ")}`);
    }
    if (result.status === "conflict") throw new FactoryError("the run changed concurrently; check status and retry");
    await this.changed();
    return { opportunity_id: opportunityId, state: result.run.state, note: reason };
  }

  async controlRun(opportunityId: string, action: "suspend" | "resume" | "cancel", role: string, reason: string, suspendTo?: "needs_input" | "blocked") {
    this.authorize("run_control", role);
    const run = await this.runs.get(runId(opportunityId));
    if (!run) throw new FactoryError(`unknown opportunity "${opportunityId}"`);
    const event =
      action === "suspend"
        ? ({ type: "suspend", to: suspendTo ?? "needs_input", reason } as const)
        : action === "resume"
          ? ({ type: "resume", reason } as const)
          : ({ type: "cancel", reason } as const);
    const result = await this.runs.apply(opportunityMachine, run.run_id, event, `${run.run_id}:${run.seq}:${action}`);
    if (result.status === "rejected") throw new FactoryError(result.problems.join("; "));
    await this.changed();
    return { opportunity_id: opportunityId, state: result.run.state };
  }

  private async contextFor(opportunityId: string): Promise<OpportunityContext> {
    const ctx: OpportunityContext = { evidence: await this.evidenceFor(opportunityId) };
    const brief = await this.latestBrief(opportunityId);
    if (!brief) return ctx;
    ctx.brief = brief;
    const review = await this.latestReview(opportunityId, brief.version);
    if (review) ctx.review = review;
    const experiment = brief.next_experiment_id
      ? await this.latestExperiment(brief.next_experiment_id)
      : await this.latestExperimentFor(opportunityId);
    if (experiment) {
      ctx.experiment = experiment;
      const auth = await this.db.query<{ action: ActionKind }>(
        "SELECT action FROM experiment_authorizations WHERE experiment_id = $1 AND experiment_version = $2",
        [experiment.experiment_id, experiment.version],
      );
      ctx.authorized_actions = auth.rows.map((r) => r.action);
      const results = await this.db.query<{ body: ExperimentResult }>(
        "SELECT body FROM experiment_results WHERE experiment_id = $1 AND experiment_version = $2 ORDER BY concluded_at",
        [experiment.experiment_id, experiment.version],
      );
      ctx.results = results.rows.map((r) => r.body);
    }
    const decision = await this.db.query<{ body: InvestmentDecision }>(
      "SELECT body FROM investment_decisions WHERE opportunity_id = $1 ORDER BY created_at DESC LIMIT 1",
      [opportunityId],
    );
    if (decision.rows[0]) ctx.decision = decision.rows[0].body;
    return ctx;
  }

  // ------------------------------------------------------------- Reads

  private async evidenceFor(opportunityId: string): Promise<EvidenceRecord[]> {
    const { rows } = await this.db.query<{ body: EvidenceRecord }>(
      "SELECT body FROM evidence WHERE opportunity_id = $1 ORDER BY retrieved_at, evidence_id",
      [opportunityId],
    );
    return rows.map((r) => r.body);
  }

  private async latestBrief(opportunityId: string): Promise<OpportunityBrief | undefined> {
    const { rows } = await this.db.query<{ body: OpportunityBrief }>(
      "SELECT body FROM opportunity_briefs WHERE opportunity_id = $1 ORDER BY version DESC LIMIT 1",
      [opportunityId],
    );
    return rows[0]?.body;
  }

  private async latestReview(opportunityId: string, briefVersion: number): Promise<SkepticReview | undefined> {
    const { rows } = await this.db.query<{ body: SkepticReview }>(
      "SELECT body FROM skeptic_reviews WHERE opportunity_id = $1 AND brief_version = $2 ORDER BY created_at DESC LIMIT 1",
      [opportunityId, briefVersion],
    );
    return rows[0]?.body;
  }

  private async latestExperiment(experimentId: string, version?: number): Promise<Experiment | undefined> {
    const { rows } = await this.db.query<{ body: Experiment }>(
      version === undefined
        ? "SELECT body FROM experiments WHERE experiment_id = $1 ORDER BY version DESC LIMIT 1"
        : "SELECT body FROM experiments WHERE experiment_id = $1 AND version = $2",
      version === undefined ? [experimentId] : [experimentId, version],
    );
    return rows[0]?.body;
  }

  private async latestExperimentFor(opportunityId: string): Promise<Experiment | undefined> {
    const { rows } = await this.db.query<{ body: Experiment }>(
      "SELECT body FROM experiments WHERE opportunity_id = $1 ORDER BY created_at DESC LIMIT 1",
      [opportunityId],
    );
    return rows[0]?.body;
  }

  /** Everything known about one opportunity, plus the suggested next step. */
  async getOpportunity(opportunityId: string) {
    await this.requireOpportunity(opportunityId);
    const run = await this.runs.get<OpportunityState>(runId(opportunityId));
    const ctx = await this.contextFor(opportunityId);
    const reviews = await this.db.query<{ body: SkepticReview }>(
      "SELECT body FROM skeptic_reviews WHERE opportunity_id = $1 ORDER BY created_at",
      [opportunityId],
    );
    const decisions = await this.db.query<{ body: InvestmentDecision }>(
      "SELECT body FROM investment_decisions WHERE opportunity_id = $1 ORDER BY created_at",
      [opportunityId],
    );
    return {
      opportunity_id: opportunityId,
      state: run?.state,
      resume_to: run?.resume_to,
      next_step: nextStep(run?.state, ctx),
      history: await this.runs.history(runId(opportunityId)),
      brief: ctx.brief,
      evidence: ctx.evidence,
      reviews: reviews.rows.map((r) => r.body),
      experiment: ctx.experiment,
      authorized_actions: ctx.authorized_actions,
      experiment_results: ctx.results,
      decisions: decisions.rows.map((r) => r.body),
    };
  }

  async status(): Promise<StatusSnapshot & { next_steps: Record<string, string> }> {
    const { rows } = await this.db.query<{ opportunity_id: string; category: string; state: string; resume_to: string | null; evidence_count: number }>(
      `SELECT o.opportunity_id, o.category, r.state, r.resume_to,
              (SELECT count(*)::int FROM evidence e WHERE e.opportunity_id = o.opportunity_id) AS evidence_count
       FROM opportunities o JOIN workflow_runs r ON r.run_id = 'opp-' || o.opportunity_id
       ORDER BY o.created_at, o.opportunity_id`,
    );
    const opportunities: StatusSnapshot["opportunities"] = [];
    const attention: string[] = [];
    const next_steps: Record<string, string> = {};
    for (const row of rows) {
      const ctx = await this.contextFor(row.opportunity_id);
      const entry: StatusSnapshot["opportunities"][number] = {
        opportunity_id: row.opportunity_id,
        category: row.category,
        state: row.state,
        evidence_count: row.evidence_count,
      };
      if (row.resume_to) entry.resume_to = row.resume_to;
      if (ctx.brief) {
        entry.evidence_stage = ctx.brief.evidence_stage;
        entry.attractiveness = ctx.brief.attractiveness.score;
        entry.confidence = ctx.brief.confidence.level;
      }
      opportunities.push(entry);
      const next = nextStep(row.state, ctx);
      if (next) {
        next_steps[row.opportunity_id] = next.action;
        if (next.owner) attention.push(`${row.opportunity_id}: ${next.action}`);
      }
    }
    const usage = this.opts.usage?.() ?? NO_USAGE;
    return {
      generated_at: this.now(),
      opportunities,
      attention,
      usage,
      budget_tokens: this.opts.config().budgets.portfolio_tokens,
      next_steps,
    };
  }
}

/** Plain-language next step for an opportunity; `owner` marks steps that need the human. */
export function nextStep(state: string | undefined, ctx: OpportunityContext): { action: string; owner: boolean } | undefined {
  const brief = ctx.brief;
  switch (state) {
    case "discovered":
      return brief
        ? { action: "controller: advance to researched", owner: false }
        : { action: "research: gather evidence, then the demand-intelligence-lead submits a brief", owner: false };
    case "researched": {
      const missing = [!ctx.review && "demand-skeptic review of the current brief", !ctx.experiment && "experiment-designer experiment"].filter(Boolean);
      if (missing.length) return { action: `needs ${missing.join(" and ")}`, owner: false };
      if (ctx.review?.recommendation === "reject") {
        return { action: "skeptic recommends rejection: owner decides whether to reject or investigate further", owner: true };
      }
      return { action: "controller: advance to experiment_ready", owner: false };
    }
    case "experiment_ready": {
      const authorized = new Set(ctx.authorized_actions ?? []);
      const pending = (ctx.experiment?.required_authorizations ?? []).filter((a) => !authorized.has(a));
      return pending.length
        ? { action: `owner: authorize experiment ${ctx.experiment?.experiment_id} (${pending.join(", ")})`, owner: true }
        : { action: "controller: advance to experimenting", owner: false };
    }
    case "experimenting":
      if (!ctx.results?.length) return { action: `run experiment ${ctx.experiment?.experiment_id} and record results`, owner: true };
      if (!ctx.decision || ctx.decision.brief_version !== brief?.version) {
        return { action: "owner: decide build, investigate further, or reject", owner: true };
      }
      return {
        action: `controller: advance to ${{ build: "build_eligible", investigate_further: "needs_more_evidence", reject: "rejected" }[ctx.decision.decision]}`,
        owner: false,
      };
    case "needs_more_evidence":
      return { action: "research further and submit a new brief version", owner: false };
    case "needs_input":
    case "blocked":
    case "exhausted_budget":
      return { action: `run is ${state}; resolve and resume`, owner: true };
    default:
      return undefined;
  }
}
