import { describe, expect, it } from "vitest";
import {
  TaskContract,
  type AgentAttempt,
  type Finding,
  type TaskContractInput,
  type VerificationResult,
} from "@factory/contracts";
import { evidence, NOW, opportunityBrief, productSpecification } from "@factory/contracts/testing";
import {
  buildMachine,
  checkReleaseGate,
  DEFAULT_RETRY_LIMITS,
  isTerminal,
  leaseExpired,
  nextStep,
  opportunityMachine,
  readyTasks,
  replay,
  start,
  transition,
  validateGraph,
  type BuildContext,
} from "./index.js";

const COMMIT = "abc1234";
const DIGEST = `sha256:${"a".repeat(64)}`;

function task(id: string, dependencies: string[] = [], extra: Partial<TaskContractInput> = {}): TaskContract {
  return TaskContract.parse({
    task_id: id,
    product_id: "language-coach",
    spec_version: 7,
    role_version: "frontend-builder-v2",
    dependencies,
    allowed_changes: ["src/**"],
    required_outputs: ["implementation_commit"],
    limits: { max_attempts: 3, spend_budget: 500 },
    ...extra,
  });
}

function result(criterion_id: string, area: VerificationResult["area"], overrides: Partial<VerificationResult> = {}): VerificationResult {
  return {
    result_id: `res-${criterion_id}-${area}`,
    product_id: "language-coach",
    spec_version: 7,
    criterion_id,
    area,
    source_commit: COMMIT,
    artifact_digest: DIGEST,
    status: "passed",
    evidence: [],
    verifier_role_version: "acceptance-tester-v1",
    ran_at: NOW,
    ...overrides,
  };
}

const passingResults = [
  result("guest_progress_survives_registration", "functional"),
  result("guest_progress_survives_registration", "experience"),
  result("cross_user_progress_denied", "access_control"),
];

describe("state machine core", () => {
  it("rejects edges that are not declared", () => {
    const r = transition(buildMachine, start(buildMachine), { type: "advance", to: "verifying", ctx: {} });
    expect(r).toEqual({ ok: false, problems: ["build: specified → verifying is not a permitted transition"] });
  });

  it("suspends and resumes to the prior stage", () => {
    const run = replay(buildMachine, [
      { type: "suspend", to: "needs_input", reason: "spec owner must decide pricing" },
      { type: "resume", reason: "answered" },
    ]);
    expect(run).toEqual({ state: "specified", seq: 2 });
  });

  it("cannot advance while suspended or after cancellation", () => {
    const suspended = replay(buildMachine, [{ type: "suspend", to: "blocked", reason: "x" }]);
    expect(transition(buildMachine, suspended, { type: "advance", to: "planned", ctx: {} }).ok).toBe(false);
    const cancelled = replay(buildMachine, [{ type: "cancel", reason: "owner stopped" }]);
    expect(isTerminal(buildMachine, cancelled)).toBe(true);
    expect(transition(buildMachine, cancelled, { type: "resume", reason: "x" }).ok).toBe(false);
  });

  it("emits a transition record for the event log", () => {
    const r = transition(buildMachine, start(buildMachine), { type: "fail", reason: "boom" });
    expect(r.ok && r.record).toEqual({ machine: "build", seq: 1, from: "specified", to: "failed", event: "fail", reason: "boom" });
  });
});

describe("opportunity machine", () => {
  const brief = opportunityBrief();
  const known = ["ev-1", "ev-2", "ev-3", "ev-4"].map((id) => evidence(id));

  it("requires every cited evidence record before research is complete", () => {
    const r = transition(opportunityMachine, start(opportunityMachine), {
      type: "advance",
      to: "researched",
      ctx: { brief, evidence: known.slice(0, 2) },
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problems).toEqual(["brief cites unknown evidence: ev-3, ev-4"]);
  });

  it("requires an independent review of the current brief version", () => {
    const researched = replay(opportunityMachine, [{ type: "advance", to: "researched", ctx: { brief, evidence: known } }]);
    const r = transition(opportunityMachine, researched, {
      type: "advance",
      to: "experiment_ready",
      ctx: {
        brief,
        review: {
          review_id: "skeptic-1",
          opportunity_id: "travel-vocab",
          brief_version: 2,
          reviewer_role_version: "demand-skeptic-v1",
          failure_modes: [{ description: "Short-lived need", severity: "major", evidence_ids: [] }],
          assumption_challenges: [],
          additional_evidence_ids: [],
          recommendation: "proceed",
          rationale: "ok",
          reviewed_at: NOW,
        },
      },
    });
    expect(!r.ok && r.problems).toEqual(["skeptic review does not cover the current brief version", "missing experiment"]);
  });
});

describe("build machine", () => {
  const spec = productSpecification();
  const tasks = [task("design"), task("onboarding", ["design", "account-api-contract-v2"], { acceptance_criteria: ["guest_progress_survives_registration"] })];

  it("refuses to plan while blocking questions are open", () => {
    const blocked = productSpecification({ open_questions: [{ question_id: "price", question: "Price?", blocking: true }] });
    const r = transition(buildMachine, start(buildMachine), {
      type: "advance",
      to: "planned",
      ctx: { spec: blocked, tasks, external_refs: new Set(["account-api-contract-v2"]) },
    });
    expect(!r.ok && r.problems).toContain("specification has blocking open questions");
  });

  it("walks the happy path only with evidence at each step", () => {
    const ctx: BuildContext = {
      spec,
      tasks,
      external_refs: new Set(["account-api-contract-v2"]),
      design_refs: ["designs/onboarding-v3"],
      source_commit: COMMIT,
      artifact_digest: DIGEST,
      verification_results: passingResults,
      findings: [],
      release_policy_decision: { effect: "allow", reason: "routine" },
      deployment_ref: "deploy-1",
    };
    const run = replay(buildMachine, [
      { type: "advance", to: "planned", ctx },
      { type: "advance", to: "designing", ctx },
      { type: "advance", to: "implementing", ctx },
      { type: "advance", to: "verifying", ctx },
      { type: "advance", to: "release_eligible", ctx },
      { type: "advance", to: "releasing", ctx },
      { type: "advance", to: "operating", ctx },
    ]);
    expect(run.state).toBe("operating");
    expect(isTerminal(buildMachine, run)).toBe(true);
  });

  it("will not release on an escalated policy decision", () => {
    const at = { state: "release_eligible" as const, seq: 5 };
    const r = transition(buildMachine, at, {
      type: "advance",
      to: "releasing",
      ctx: {
        spec,
        source_commit: COMMIT,
        artifact_digest: DIGEST,
        verification_results: passingResults,
        release_policy_decision: { effect: "escalate", reason: "pricing change" },
      },
    });
    expect(!r.ok && r.problems).toEqual(["release policy decision is escalate: pricing change"]);
  });
});

describe("release gate", () => {
  const spec = productSpecification();
  const gate = (results: VerificationResult[], findings: Finding[] = []) =>
    checkReleaseGate({ spec, source_commit: COMMIT, artifact_digest: DIGEST, results, findings });

  it("passes when every must criterion and area passes on this artifact", () => {
    const report = gate(passingResults);
    expect(report.eligible).toBe(true);
    expect(report.coverage).toEqual({
      guest_progress_survives_registration: "passed",
      cross_user_progress_denied: "passed",
      streak_badge_visible: "missing",
    });
  });

  it("ignores evidence from a different commit or artifact", () => {
    const stale = passingResults.map((r) => ({ ...r, source_commit: "def5678" }));
    const report = gate(stale);
    expect(report.eligible).toBe(false);
    expect(report.stale_result_ids).toHaveLength(3);
  });

  it("requires every declared verification area", () => {
    const report = gate(passingResults.filter((r) => r.area !== "experience"));
    expect(report.problems).toEqual(["guest-onboarding: experience verification not covered"]);
  });

  it("blocks on any failure, even for optional requirements", () => {
    const report = gate([...passingResults, result("streak_badge_visible", "experience", { status: "failed" })]);
    expect(report.problems).toEqual(["streak-badge/streak_badge_visible: failed (res-streak_badge_visible-experience)"]);
  });

  it("blocks on open high-severity findings", () => {
    const finding: Finding = {
      finding_id: "f1",
      product_id: "language-coach",
      severity: "critical",
      area: "security_privacy",
      requirement_ids: [],
      source_commit: COMMIT,
      summary: "Session token logged",
      reproduction: "Sign in and inspect logs",
      status: "open",
    };
    expect(gate(passingResults, [finding]).eligible).toBe(false);
    expect(gate(passingResults, [{ ...finding, status: "fixed" }]).eligible).toBe(true);
  });
});

describe("task graph", () => {
  it("detects unknown dependencies and cycles", () => {
    const problems = validateGraph([task("a", ["b"]), task("b", ["c"]), task("c", ["a"]), task("d", ["ghost"])]);
    expect(problems.unknown_dependencies).toEqual([{ task_id: "d", dependency: "ghost" }]);
    expect(problems.cycles).toEqual([["a", "b", "c", "a"]]);
  });

  it("only queues tasks whose dependencies are satisfied", () => {
    const tasks = [task("a"), task("b", ["a"]), task("c", ["a", "api-v2"]), task("d")];
    expect(readyTasks(tasks, new Set(), new Set(["d"])).map((t) => t.task_id)).toEqual(["a"]);
    expect(readyTasks(tasks, new Set(["a"])).map((t) => t.task_id)).toEqual(["b", "d"]);
    expect(readyTasks(tasks, new Set(["a", "api-v2"])).map((t) => t.task_id)).toEqual(["b", "c", "d"]);
  });

  it("reports lease expiry", () => {
    const lease = { owner: "w1", acquired_at: NOW, heartbeat_at: NOW, expires_at: "2026-10-23T12:05:00Z" };
    expect(leaseExpired(lease, "2026-10-23T12:04:59Z")).toBe(false);
    expect(leaseExpired(lease, "2026-10-23T12:05:00Z")).toBe(true);
  });
});

describe("retry policy", () => {
  const limits = { ...DEFAULT_RETRY_LIMITS, max_attempts: 3 };
  let n = 0;
  const attempt = (status: AgentAttempt["status"], failure_kind?: AgentAttempt["failure_kind"], failure_detail?: string): AgentAttempt => ({
    attempt_id: `at-${++n}`,
    task_id: "t",
    attempt_number: n,
    worker_id: "w",
    role_version: "frontend-builder-v2",
    status,
    ...(failure_kind && { failure_kind }),
    ...(failure_detail && { failure_detail }),
    outputs: [],
    cost_usd_cents: 0,
    started_at: NOW,
  });

  it("backs off on infrastructure failures without spending implementation attempts", () => {
    const attempts = [attempt("failed", "transient_infrastructure"), attempt("failed", "lease_expired")];
    expect(nextStep(attempts, limits)).toMatchObject({ kind: "retry", backoff_ms: 4_000 });
    const many = Array.from({ length: 6 }, () => attempt("failed", "transient_infrastructure"));
    expect(nextStep(many, limits)).toMatchObject({ kind: "suspend", to: "blocked" });
  });

  it("fails with a diagnosis after max implementation attempts", () => {
    const attempts = [
      attempt("failed", "implementation", "test A fails"),
      attempt("failed", "transient_infrastructure"),
      attempt("failed", "implementation", "test A fails"),
    ];
    expect(nextStep(attempts, limits)).toMatchObject({ kind: "retry" });
    const step = nextStep([...attempts, attempt("failed", "implementation", "test B fails")], limits);
    expect(step.kind).toBe("fail");
    expect(step.kind === "fail" && step.reason).toMatch(/3\/3 attempts.*test B fails/);
  });

  it("routes missing information, budget, and policy to the right suspension", () => {
    expect(nextStep([attempt("failed", "missing_information")], limits)).toMatchObject({ to: "needs_input" });
    expect(nextStep([attempt("failed", "budget_exhausted")], limits)).toMatchObject({ to: "exhausted_budget" });
    expect(nextStep([attempt("failed", "policy_denied")], limits)).toMatchObject({ to: "blocked" });
    expect(nextStep([attempt("succeeded")], limits)).toEqual({ kind: "succeeded" });
  });
});
