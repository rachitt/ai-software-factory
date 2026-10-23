import type { AgentAttempt } from "@factory/contracts";

export interface RetryLimits {
  /** Implementation attempts allowed by the task contract. */
  max_attempts: number;
  /** Infrastructure retries are counted separately so flaky sandboxes do not burn implementation attempts. */
  max_infrastructure_retries: number;
  base_backoff_ms: number;
  max_backoff_ms: number;
}

export const DEFAULT_RETRY_LIMITS: Omit<RetryLimits, "max_attempts"> = {
  max_infrastructure_retries: 5,
  base_backoff_ms: 2_000,
  max_backoff_ms: 120_000,
};

export type NextStep =
  | { kind: "succeeded" }
  | { kind: "retry"; backoff_ms: number; reason: string }
  | { kind: "suspend"; to: "needs_input" | "blocked" | "exhausted_budget"; reason: string }
  | { kind: "fail"; reason: string };

/**
 * Decides what happens after an attempt finishes. Distinguishes transient
 * infrastructure failures from implementation failures and missing information
 * (architecture.md §6). Repeated implementation failure stops with a diagnosis.
 */
export function nextStep(attempts: readonly AgentAttempt[], limits: RetryLimits): NextStep {
  const last = attempts.at(-1);
  if (!last) return { kind: "retry", backoff_ms: 0, reason: "no attempts yet" };
  if (last.status === "succeeded") return { kind: "succeeded" };
  if (last.status === "running") throw new Error(`attempt ${last.attempt_id} is still running`);

  const kind = last.failure_kind ?? "implementation";
  const detail = last.failure_detail ? `: ${last.failure_detail}` : "";

  switch (kind) {
    case "transient_infrastructure":
    case "lease_expired": {
      const infra = attempts.filter(
        (a) => a.failure_kind === "transient_infrastructure" || a.failure_kind === "lease_expired",
      ).length;
      if (infra > limits.max_infrastructure_retries) {
        return { kind: "suspend", to: "blocked", reason: `infrastructure failed ${infra} times${detail}` };
      }
      const backoff = Math.min(limits.max_backoff_ms, limits.base_backoff_ms * 2 ** (infra - 1));
      return { kind: "retry", backoff_ms: backoff, reason: `transient ${kind}${detail}` };
    }
    case "implementation": {
      const impl = attempts.filter((a) => a.status === "failed" && (a.failure_kind ?? "implementation") === "implementation").length;
      if (impl >= limits.max_attempts) {
        const history = attempts
          .filter((a) => (a.failure_kind ?? "implementation") === "implementation")
          .map((a) => `#${a.attempt_number}: ${a.failure_detail ?? "no detail"}`)
          .join("; ");
        return { kind: "fail", reason: `implementation failed ${impl}/${limits.max_attempts} attempts (${history})` };
      }
      return { kind: "retry", backoff_ms: 0, reason: `implementation attempt ${impl} failed${detail}` };
    }
    case "missing_information":
      return { kind: "suspend", to: "needs_input", reason: `missing information${detail}` };
    case "budget_exhausted":
      return { kind: "suspend", to: "exhausted_budget", reason: `budget exhausted${detail}` };
    case "policy_denied":
      return { kind: "suspend", to: "blocked", reason: `action denied by policy${detail}` };
  }
}
