import { transition, type Event, type MachineDef, type RunState, type TransitionRecord } from "@factory/workflow";
import { pgErrorCode, UNIQUE_VIOLATION, type Db } from "./db.js";

export interface StoredRun<S extends string> extends RunState<S> {
  run_id: string;
  machine: string;
  subject_id: string;
}

export type ApplyResult<S extends string> =
  | { status: "applied"; run: StoredRun<S>; record: TransitionRecord<S> }
  /** The same idempotency key was already applied; nothing changed. */
  | { status: "duplicate"; run: StoredRun<S> }
  | { status: "rejected"; run: StoredRun<S>; problems: string[] }
  /** Another writer advanced the run first; reload and decide again. */
  | { status: "conflict"; run: StoredRun<S> };

interface RunRow {
  run_id: string;
  machine: string;
  subject_id: string;
  state: string;
  resume_to: string | null;
  seq: number;
}

function toRun<S extends string>(row: RunRow): StoredRun<S> {
  const run: StoredRun<S> = {
    run_id: row.run_id,
    machine: row.machine,
    subject_id: row.subject_id,
    state: row.state as StoredRun<S>["state"],
    seq: row.seq,
  };
  if (row.resume_to !== null) run.resume_to = row.resume_to as S;
  return run;
}

/**
 * Persists workflow runs as an append-only transition log plus a current-state
 * projection. Each accepted transition is written with:
 *   - optimistic concurrency on `seq`, so two controllers cannot both advance a run;
 *   - a unique idempotency key, so a retried activity cannot apply twice.
 */
export class WorkflowStore {
  constructor(private readonly db: Db) {}

  async create<S extends string, Ctx>(def: MachineDef<S, Ctx>, run_id: string, subject_id: string): Promise<StoredRun<S>> {
    const { rows } = await this.db.query<RunRow>(
      `INSERT INTO workflow_runs (run_id, machine, subject_id, state) VALUES ($1, $2, $3, $4)
       ON CONFLICT (run_id) DO NOTHING
       RETURNING run_id, machine, subject_id, state, resume_to, seq`,
      [run_id, def.name, subject_id, def.initial],
    );
    if (rows[0]) return toRun(rows[0]);
    const existing = await this.get<S>(run_id);
    if (!existing || existing.machine !== def.name || existing.subject_id !== subject_id) {
      throw new Error(`run ${run_id} already exists with different parameters`);
    }
    return existing;
  }

  async get<S extends string>(run_id: string): Promise<StoredRun<S> | undefined> {
    const { rows } = await this.db.query<RunRow>(
      "SELECT run_id, machine, subject_id, state, resume_to, seq FROM workflow_runs WHERE run_id = $1",
      [run_id],
    );
    return rows[0] && toRun<S>(rows[0]);
  }

  async history(run_id: string): Promise<Array<{ seq: number; from_state: string; to_state: string; event: string; reason: string | null }>> {
    const { rows } = await this.db.query<{ seq: number; from_state: string; to_state: string; event: string; reason: string | null }>(
      "SELECT seq, from_state, to_state, event, reason FROM workflow_transitions WHERE run_id = $1 ORDER BY seq",
      [run_id],
    );
    return rows;
  }

  async apply<S extends string, Ctx>(
    def: MachineDef<S, Ctx>,
    run_id: string,
    event: Event<S, Ctx>,
    idempotency_key: string,
  ): Promise<ApplyResult<S>> {
    const run = await this.get<S>(run_id);
    if (!run) throw new Error(`unknown run ${run_id}`);
    if (run.machine !== def.name) throw new Error(`run ${run_id} is a ${run.machine} run, not ${def.name}`);

    const { rows: prior } = await this.db.query<{ run_id: string }>(
      "SELECT run_id FROM workflow_transitions WHERE idempotency_key = $1",
      [idempotency_key],
    );
    if (prior[0]) {
      if (prior[0].run_id !== run_id) throw new Error(`idempotency key ${idempotency_key} belongs to run ${prior[0].run_id}`);
      return { status: "duplicate", run };
    }

    const result = transition(def, run, event);
    if (!result.ok) return { status: "rejected", run, problems: result.problems };
    const { next, record } = result;

    try {
      return await this.db.transaction(async (tx) => {
        const { rows } = await tx.query<RunRow>(
          `UPDATE workflow_runs SET state = $2, resume_to = $3, seq = $4, updated_at = now()
           WHERE run_id = $1 AND seq = $5
           RETURNING run_id, machine, subject_id, state, resume_to, seq`,
          [run_id, next.state, next.resume_to ?? null, next.seq, run.seq],
        );
        if (!rows[0]) throw new ConcurrencyConflict();
        await tx.query(
          `INSERT INTO workflow_transitions (run_id, seq, from_state, to_state, event, reason, idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [run_id, record.seq, record.from, record.to, record.event, record.reason ?? null, idempotency_key],
        );
        return { status: "applied", run: toRun<S>(rows[0]), record } as const;
      });
    } catch (err) {
      const latest = (await this.get<S>(run_id))!;
      if (err instanceof ConcurrencyConflict) return { status: "conflict", run: latest };
      if (pgErrorCode(err) === UNIQUE_VIOLATION) {
        // Lost a race with a writer using the same key or the same seq.
        const { rows } = await this.db.query<{ run_id: string }>(
          "SELECT run_id FROM workflow_transitions WHERE idempotency_key = $1",
          [idempotency_key],
        );
        return rows[0] ? { status: "duplicate", run: latest } : { status: "conflict", run: latest };
      }
      throw err;
    }
  }
}

class ConcurrencyConflict extends Error {
  constructor() {
    super("workflow run was advanced concurrently");
  }
}
