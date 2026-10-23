import {
  allCriteria,
  type Finding,
  type ProductSpecification,
  type VerificationArea,
  type VerificationResult,
} from "@factory/contracts";

export interface ReleaseCandidate {
  spec: ProductSpecification;
  source_commit: string;
  artifact_digest: string;
  results: readonly VerificationResult[];
  findings: readonly Finding[];
}

export interface GateReport {
  eligible: boolean;
  problems: string[];
  /** criterion_id → status of the result bound to this exact candidate. */
  coverage: Record<string, VerificationResult["status"] | "missing">;
  /** Results ignored because they ran against a different spec, commit, or artifact. */
  stale_result_ids: string[];
}

/**
 * Engineering-readiness gate. Evidence only counts when it was produced against
 * this exact specification version, source commit, and artifact digest; any
 * later change invalidates it. Builders cannot weaken this gate because it
 * reads requirements from the versioned specification, not from task output.
 *
 * Rules:
 *   - Every criterion of every `must` requirement has a passing result.
 *   - Every verification area a `must` requirement declares is covered by a pass.
 *   - No criterion of any priority has a failed or errored result.
 *   - No open high or critical finding exists for this product.
 */
export function checkReleaseGate(candidate: ReleaseCandidate): GateReport {
  const { spec, source_commit, artifact_digest } = candidate;
  const problems: string[] = [];
  const stale_result_ids: string[] = [];

  const current = new Map<string, VerificationResult[]>();
  for (const r of candidate.results) {
    const bound =
      r.product_id === spec.product_id &&
      r.spec_version === spec.spec_version &&
      r.source_commit === source_commit &&
      r.artifact_digest === artifact_digest;
    if (!bound) {
      stale_result_ids.push(r.result_id);
      continue;
    }
    current.set(r.criterion_id, [...(current.get(r.criterion_id) ?? []), r]);
  }

  const coverage: GateReport["coverage"] = {};
  for (const { requirement, criterion } of allCriteria(spec)) {
    const results = current.get(criterion.criterion_id) ?? [];
    const bad = results.find((r) => r.status === "failed" || r.status === "error");
    const passed = results.some((r) => r.status === "passed");
    coverage[criterion.criterion_id] = bad ? bad.status : passed ? "passed" : (results[0]?.status ?? "missing");

    if (bad) problems.push(`${requirement.requirement_id}/${criterion.criterion_id}: ${bad.status} (${bad.result_id})`);
    else if (requirement.priority === "must" && !passed) {
      problems.push(`${requirement.requirement_id}/${criterion.criterion_id}: no passing result for this artifact`);
    }
  }

  for (const requirement of spec.requirements) {
    if (requirement.priority !== "must") continue;
    const covered = new Set<VerificationArea>();
    for (const c of requirement.acceptance_criteria) {
      for (const r of current.get(c.criterion_id) ?? []) if (r.status === "passed") covered.add(r.area);
    }
    for (const area of requirement.verification_areas) {
      if (!covered.has(area)) problems.push(`${requirement.requirement_id}: ${area} verification not covered`);
    }
  }

  for (const f of candidate.findings) {
    if (f.product_id === spec.product_id && f.status === "open" && (f.severity === "high" || f.severity === "critical")) {
      problems.push(`open ${f.severity} finding ${f.finding_id}: ${f.summary}`);
    }
  }

  return { eligible: problems.length === 0, problems, coverage, stale_result_ids };
}
