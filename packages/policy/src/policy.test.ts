import { describe, expect, it } from "vitest";
import { Policy, type ActionRequest } from "@factory/contracts";
import { BudgetLedger, evaluate, scopeChain } from "./index.js";

const portfolio = Policy.parse({
  policy_id: "portfolio-default",
  version: 3,
  scope: { level: "portfolio" },
  rules: [
    { rule_id: "models", action: "model_call", effect: "allow", max_usd_cents_per_action: 500, exception_owner: "owner" },
    { rule_id: "sandbox", action: "sandbox_exec", effect: "allow", environments: ["sandbox"], exception_owner: "owner" },
    {
      rule_id: "routine-prod",
      action: "deploy",
      effect: "allow",
      environments: ["staging", "production"],
      release_categories: ["routine_fix", "security_fix"],
      exception_owner: "owner",
    },
    { rule_id: "pricing", action: "deploy", effect: "escalate", release_categories: ["pricing_change"], exception_owner: "owner" },
    { rule_id: "no-spend", action: "spend_money", effect: "deny", exception_owner: "owner" },
  ],
});

const productFreeze = Policy.parse({
  policy_id: "language-coach-freeze",
  version: 1,
  scope: { level: "product", product_id: "language-coach" },
  rules: [{ rule_id: "freeze", action: "deploy", effect: "deny", environments: ["production"], exception_owner: "owner" }],
});

function request(overrides: Partial<ActionRequest> = {}): ActionRequest {
  return {
    request_id: "r1",
    action: "model_call",
    environment: "sandbox",
    actor: { role_version: "frontend-builder-v2", worker_id: "w1", product_id: "other-app", run_id: "run-1", task_id: "t1" },
    estimated_usd_cents: 100,
    idempotency_key: "k1",
    ...overrides,
  };
}

describe("evaluate", () => {
  it("allows within a rule's cap and escalates above it", () => {
    expect(evaluate([portfolio], request()).effect).toBe("allow");
    const over = evaluate([portfolio], request({ estimated_usd_cents: 900 }));
    expect(over).toMatchObject({ effect: "escalate", rule_id: "models", exception_owner: "owner" });
  });

  it("denies anything no rule permits", () => {
    expect(evaluate([portfolio], request({ action: "send_communication" })).effect).toBe("deny");
    expect(evaluate([portfolio], request({ action: "sandbox_exec", environment: "production" })).effect).toBe("deny");
    expect(evaluate([], request())).toEqual({ effect: "deny", reason: "no rule permits model_call in sandbox" });
  });

  it("gates releases by category", () => {
    const deploy = (release_category: ActionRequest["release_category"]) =>
      evaluate([portfolio], request({ action: "deploy", environment: "production", ...(release_category && { release_category }) }));
    expect(deploy("routine_fix").effect).toBe("allow");
    expect(deploy("pricing_change").effect).toBe("escalate");
    expect(deploy("feature").effect).toBe("deny");
    expect(deploy(undefined).effect).toBe("deny");
  });

  it("explicit deny wins", () => {
    expect(evaluate([portfolio], request({ action: "spend_money" })).effect).toBe("deny");
  });

  it("applies product policies only to their product", () => {
    const deploy = (product_id: string) =>
      evaluate(
        [portfolio, productFreeze],
        request({ action: "deploy", environment: "production", release_category: "routine_fix", actor: { ...request().actor, product_id } }),
      );
    expect(deploy("language-coach")).toMatchObject({ effect: "deny", policy_id: "language-coach-freeze" });
    expect(deploy("other-app").effect).toBe("allow");
  });
});

describe("BudgetLedger", () => {
  const chain = scopeChain(request().actor);

  function ledger() {
    const l = new BudgetLedger();
    l.setLimit({ level: "portfolio", id: "default" }, "usd_cents", 10_000);
    l.setLimit({ level: "product", id: "other-app" }, "usd_cents", 5_000);
    l.setLimit({ level: "task", id: "t1" }, "usd_cents", 1_000);
    return l;
  }

  it("builds the charge chain from the actor", () => {
    expect(chain.map((s) => s.level)).toEqual(["portfolio", "product", "run", "task"]);
  });

  it("rejects a reservation that exceeds the tightest scope", () => {
    const l = ledger();
    expect(l.reserve("a", chain, "usd_cents", 800).ok).toBe(true);
    const second = l.reserve("b", chain, "usd_cents", 300);
    expect(second).toEqual({ ok: false, exhausted: { level: "task", id: "t1" }, requested: 300, available: 200 });
  });

  it("is idempotent per key so retries do not double-charge", () => {
    const l = ledger();
    l.reserve("a", chain, "usd_cents", 600);
    l.reserve("a", chain, "usd_cents", 600);
    expect(l.usage({ level: "task", id: "t1" }, "usd_cents").reserved).toBe(600);
    expect(() => l.reserve("a", chain, "usd_cents", 700)).toThrow(/different parameters/);
    l.commit("a", 550);
    l.commit("a", 550);
    expect(l.usage({ level: "product", id: "other-app" }, "usd_cents")).toMatchObject({ reserved: 0, committed: 550, available: 4_450 });
  });

  it("releases unused reservations and records overruns", () => {
    const l = ledger();
    l.reserve("a", chain, "usd_cents", 500);
    l.release("a");
    expect(l.usage({ level: "task", id: "t1" }, "usd_cents").available).toBe(1_000);
    l.reserve("b", chain, "usd_cents", 900);
    l.commit("b", 1_200);
    expect(l.usage({ level: "task", id: "t1" }, "usd_cents")).toMatchObject({ committed: 1_200, available: 0 });
    expect(() => l.release("b")).toThrow(/already committed/);
  });

  it("bounds worker creation the same way", () => {
    const l = new BudgetLedger();
    l.setLimit({ level: "run", id: "run-1" }, "worker_slots", 2);
    expect(l.reserve("w1", chain, "worker_slots", 1).ok).toBe(true);
    expect(l.reserve("w2", chain, "worker_slots", 1).ok).toBe(true);
    expect(l.reserve("w3", chain, "worker_slots", 1).ok).toBe(false);
    l.release("w1");
    expect(l.reserve("w3", chain, "worker_slots", 1).ok).toBe(true);
  });
});
