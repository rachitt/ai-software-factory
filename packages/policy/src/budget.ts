import type { ActionRequest } from "@factory/contracts";

export type ScopeLevel = "portfolio" | "product" | "run" | "task";
export interface ScopeRef {
  level: ScopeLevel;
  id: string;
}

/** `usd_cents` covers model calls, compute, APIs and experiments; `worker_slots` bounds concurrency. */
export type Resource = "usd_cents" | "worker_slots";

export interface Usage {
  limit: number | undefined;
  reserved: number;
  committed: number;
  /** Infinity when the scope has no limit. */
  available: number;
}

export interface Reservation {
  key: string;
  chain: readonly ScopeRef[];
  resource: Resource;
  amount: number;
  state: "reserved" | "committed" | "released";
  committed_amount?: number;
}

export type ReserveResult =
  | { ok: true; reservation: Reservation }
  | { ok: false; exhausted: ScopeRef; requested: number; available: number };

const scopeKey = (s: ScopeRef, r: Resource) => `${s.level}:${s.id}:${r}`;

/** The scopes an action is charged against, broadest first. */
export function scopeChain(actor: ActionRequest["actor"], portfolioId = "default"): ScopeRef[] {
  const chain: ScopeRef[] = [{ level: "portfolio", id: portfolioId }];
  if (actor.product_id) chain.push({ level: "product", id: actor.product_id });
  if (actor.run_id) chain.push({ level: "run", id: actor.run_id });
  if (actor.task_id) chain.push({ level: "task", id: actor.task_id });
  return chain;
}

/**
 * Hierarchical budget ledger. Workers reserve before costly operations, then
 * commit actual cost or release. Reservation keys make retries idempotent:
 * a retried activity that re-reserves with the same key does not double-charge.
 *
 * This is the in-memory reference implementation; the control plane persists
 * the same model in `budget_limits` and `budget_reservations`.
 */
export class BudgetLedger {
  private readonly limits = new Map<string, number>();
  private readonly reserved = new Map<string, number>();
  private readonly committed = new Map<string, number>();
  private readonly reservations = new Map<string, Reservation>();

  setLimit(scope: ScopeRef, resource: Resource, limit: number): void {
    if (!Number.isInteger(limit) || limit < 0) throw new RangeError("limit must be a non-negative integer");
    this.limits.set(scopeKey(scope, resource), limit);
  }

  usage(scope: ScopeRef, resource: Resource): Usage {
    const k = scopeKey(scope, resource);
    const limit = this.limits.get(k);
    const reserved = this.reserved.get(k) ?? 0;
    const committed = this.committed.get(k) ?? 0;
    return {
      limit,
      reserved,
      committed,
      available: limit === undefined ? Infinity : Math.max(0, limit - reserved - committed),
    };
  }

  reserve(key: string, chain: readonly ScopeRef[], resource: Resource, amount: number): ReserveResult {
    if (!Number.isInteger(amount) || amount < 0) throw new RangeError("amount must be a non-negative integer");
    const existing = this.reservations.get(key);
    if (existing) {
      if (existing.resource !== resource || existing.amount !== amount) {
        throw new Error(`reservation key ${key} reused with different parameters`);
      }
      return { ok: true, reservation: existing };
    }

    for (const scope of chain) {
      const { available } = this.usage(scope, resource);
      if (amount > available) return { ok: false, exhausted: scope, requested: amount, available };
    }

    for (const scope of chain) this.add(this.reserved, scopeKey(scope, resource), amount);
    const reservation: Reservation = { key, chain: [...chain], resource, amount, state: "reserved" };
    this.reservations.set(key, reservation);
    return { ok: true, reservation };
  }

  /**
   * Converts a reservation into actual usage. Actual cost may exceed the
   * reservation (e.g. a model call ran long); the overrun is recorded so the
   * scope shows as exhausted rather than hidden.
   */
  commit(key: string, actual: number): Reservation {
    const r = this.get(key);
    if (r.state === "committed") return r;
    if (r.state === "released") throw new Error(`reservation ${key} was released`);
    for (const scope of r.chain) {
      const k = scopeKey(scope, r.resource);
      this.add(this.reserved, k, -r.amount);
      this.add(this.committed, k, actual);
    }
    r.state = "committed";
    r.committed_amount = actual;
    return r;
  }

  release(key: string): Reservation {
    const r = this.get(key);
    if (r.state === "released") return r;
    if (r.state === "committed") throw new Error(`reservation ${key} was already committed`);
    for (const scope of r.chain) this.add(this.reserved, scopeKey(scope, r.resource), -r.amount);
    r.state = "released";
    return r;
  }

  private get(key: string): Reservation {
    const r = this.reservations.get(key);
    if (!r) throw new Error(`unknown reservation ${key}`);
    return r;
  }

  private add(map: Map<string, number>, k: string, delta: number): void {
    map.set(k, (map.get(k) ?? 0) + delta);
  }
}
