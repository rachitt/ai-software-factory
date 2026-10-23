import type { Lease, TaskContract } from "@factory/contracts";

export interface GraphProblems {
  duplicate_ids: string[];
  /** Dependencies that are neither tasks in the graph nor known external artifacts. */
  unknown_dependencies: Array<{ task_id: string; dependency: string }>;
  /** Each cycle as an ordered list of task ids. */
  cycles: string[][];
}

/**
 * Validates a task dependency graph. Dependencies may name other tasks or
 * versioned external artifacts (e.g. `account-api-contract-v2`).
 */
export function validateGraph(tasks: readonly TaskContract[], externalRefs: ReadonlySet<string> = new Set()): GraphProblems {
  const ids = new Set<string>();
  const duplicate_ids: string[] = [];
  for (const t of tasks) {
    if (ids.has(t.task_id)) duplicate_ids.push(t.task_id);
    ids.add(t.task_id);
  }

  const unknown_dependencies = tasks.flatMap((t) =>
    t.dependencies
      .filter((d) => !ids.has(d) && !externalRefs.has(d))
      .map((dependency) => ({ task_id: t.task_id, dependency })),
  );

  const byId = new Map(tasks.map((t) => [t.task_id, t]));
  const color = new Map<string, "visiting" | "done">();
  const cycles: string[][] = [];
  const stack: string[] = [];
  const visit = (id: string) => {
    color.set(id, "visiting");
    stack.push(id);
    for (const dep of byId.get(id)?.dependencies ?? []) {
      if (!byId.has(dep)) continue;
      const c = color.get(dep);
      if (c === "visiting") cycles.push([...stack.slice(stack.indexOf(dep)), dep]);
      else if (c === undefined) visit(dep);
    }
    stack.pop();
    color.set(id, "done");
  };
  for (const t of tasks) if (!color.has(t.task_id)) visit(t.task_id);

  return { duplicate_ids, unknown_dependencies, cycles };
}

export function graphIsValid(problems: GraphProblems): boolean {
  return problems.duplicate_ids.length + problems.unknown_dependencies.length + problems.cycles.length === 0;
}

/**
 * Tasks whose dependencies are all satisfied and that are not already done
 * or in progress. Only these enter the work queue.
 */
export function readyTasks(
  tasks: readonly TaskContract[],
  satisfied: ReadonlySet<string>,
  inProgress: ReadonlySet<string> = new Set(),
): TaskContract[] {
  return tasks.filter(
    (t) => !satisfied.has(t.task_id) && !inProgress.has(t.task_id) && t.dependencies.every((d) => satisfied.has(d)),
  );
}

/** A lease whose heartbeat lapsed can be reclaimed by a replacement worker. */
export function leaseExpired(lease: Lease, now: string): boolean {
  return Date.parse(now) >= Date.parse(lease.expires_at);
}
