/**
 * Engine-agnostic workflow state machines. Everything here is a pure function
 * of its inputs (no clocks, randomness, or IO), so the same code can run inside
 * a durable engine's deterministic workflow code and be replayed safely.
 */

/** States reachable from any non-terminal stage (architecture.md §6). */
export const EXCEPTION_STATES = ["needs_input", "blocked", "cancelled", "failed", "exhausted_budget"] as const;
export type ExceptionState = (typeof EXCEPTION_STATES)[number];

/** Exception states a run can come back from once the cause is resolved. */
const RESUMABLE: ReadonlySet<ExceptionState> = new Set(["needs_input", "blocked", "exhausted_budget"]);

export interface MachineDef<S extends string, Ctx> {
  name: string;
  initial: S;
  /** Forward edges. A state with no edges is terminal. */
  edges: { readonly [K in S]: readonly S[] };
  /** Evidence required to enter a state. Returns problems; empty means satisfied. */
  guards: { readonly [K in S]?: (ctx: Ctx) => string[] };
}

export interface RunState<S extends string> {
  state: S | ExceptionState;
  /** Set while in an exception state: where a resume returns to. */
  resume_to?: S;
  /** Increments on every accepted transition; used for optimistic concurrency. */
  seq: number;
}

export type Event<S extends string, Ctx> =
  | { type: "advance"; to: S; ctx: Ctx }
  | { type: "suspend"; to: "needs_input" | "blocked" | "exhausted_budget"; reason: string }
  | { type: "resume"; reason: string }
  | { type: "cancel"; reason: string }
  | { type: "fail"; reason: string };

export interface TransitionRecord<S extends string> {
  machine: string;
  seq: number;
  from: S | ExceptionState;
  to: S | ExceptionState;
  event: Event<S, unknown>["type"];
  reason?: string;
}

export type TransitionResult<S extends string> =
  | { ok: true; next: RunState<S>; record: TransitionRecord<S> }
  | { ok: false; problems: string[] };

export function start<S extends string, Ctx>(def: MachineDef<S, Ctx>): RunState<S> {
  return { state: def.initial, seq: 0 };
}

export function isException(state: string): state is ExceptionState {
  return (EXCEPTION_STATES as readonly string[]).includes(state);
}

export function isTerminal<S extends string, Ctx>(def: MachineDef<S, Ctx>, run: RunState<S>): boolean {
  if (isException(run.state)) return run.state === "cancelled" || run.state === "failed";
  return def.edges[run.state].length === 0;
}

export function transition<S extends string, Ctx>(
  def: MachineDef<S, Ctx>,
  run: RunState<S>,
  event: Event<S, Ctx>,
): TransitionResult<S> {
  const fail = (...problems: string[]): TransitionResult<S> => ({ ok: false, problems });
  const accept = (to: S | ExceptionState, extra: Partial<RunState<S>> = {}, reason?: string): TransitionResult<S> => {
    const next: RunState<S> = { state: to, seq: run.seq + 1, ...extra };
    const record: TransitionRecord<S> = { machine: def.name, seq: next.seq, from: run.state, to, event: event.type };
    if (reason !== undefined) record.reason = reason;
    return { ok: true, next, record };
  };

  if (isTerminal(def, run)) return fail(`${def.name} is in terminal state ${run.state}`);

  switch (event.type) {
    case "advance": {
      if (isException(run.state)) return fail(`cannot advance from ${run.state}; resume first`);
      if (!def.edges[run.state].includes(event.to)) {
        return fail(`${def.name}: ${run.state} → ${event.to} is not a permitted transition`);
      }
      const problems = def.guards[event.to]?.(event.ctx) ?? [];
      return problems.length ? fail(...problems) : accept(event.to);
    }
    case "suspend": {
      if (isException(run.state)) return fail(`already suspended in ${run.state}`);
      return accept(event.to, { resume_to: run.state }, event.reason);
    }
    case "resume": {
      if (!isException(run.state) || !RESUMABLE.has(run.state) || run.resume_to === undefined) {
        return fail(`cannot resume from ${run.state}`);
      }
      return accept(run.resume_to, {}, event.reason);
    }
    case "cancel":
      return accept("cancelled", {}, event.reason);
    case "fail":
      return accept("failed", {}, event.reason);
  }
}

/** Replays a sequence of events from the initial state; throws on the first rejected event. */
export function replay<S extends string, Ctx>(def: MachineDef<S, Ctx>, events: readonly Event<S, Ctx>[]): RunState<S> {
  let run = start(def);
  for (const [i, event] of events.entries()) {
    const result = transition(def, run, event);
    if (!result.ok) throw new Error(`event ${i} rejected: ${result.problems.join("; ")}`);
    run = result.next;
  }
  return run;
}

/** Helper for guards: report a missing field. */
export function required<T>(value: T | undefined, what: string, problems: string[]): value is T {
  if (value === undefined) problems.push(`missing ${what}`);
  return value !== undefined;
}
