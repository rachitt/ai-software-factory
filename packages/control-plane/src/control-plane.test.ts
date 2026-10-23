import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildMachine, type BuildContext } from "@factory/workflow";
import { productSpecification } from "@factory/contracts/testing";
import { migrate, WorkflowStore } from "./index.js";

let db: PGlite;

beforeEach(async () => {
  db = new PGlite();
  await migrate(db);
});
afterEach(async () => {
  await db.close();
});

const ctx: BuildContext = {
  spec: productSpecification(),
  tasks: [],
  design_refs: ["designs/v1"],
};

describe("migrations", () => {
  it("applies once and is idempotent", async () => {
    expect(await migrate(db)).toEqual([]);
    const { rows } = await db.query<{ name: string }>("SELECT name FROM schema_migrations");
    expect(rows.map((r) => r.name)).toEqual(["0001_init.sql", "0002_attribution_and_authorizations.sql"]);
  });

  it("makes versioned records immutable", async () => {
    await db.query("INSERT INTO products (product_id, category, platform) VALUES ('p', 'learning', 'web')");
    await db.query("INSERT INTO specification_versions (product_id, spec_version, body) VALUES ('p', 1, '{}')");
    await expect(db.query("UPDATE specification_versions SET body = '{\"x\":1}'")).rejects.toThrow(/immutable/);
    await expect(db.query("DELETE FROM specification_versions")).rejects.toThrow(/immutable/);
  });

  it("rejects platforms outside the contract", async () => {
    await expect(db.query("INSERT INTO products (product_id, category, platform) VALUES ('p', 'l', 'desktop')")).rejects.toThrow();
  });
});

describe("WorkflowStore", () => {
  it("persists accepted transitions and their history", async () => {
    const store = new WorkflowStore(db);
    await store.create(buildMachine, "run-1", "language-coach");
    const r = await store.apply(buildMachine, "run-1", { type: "suspend", to: "needs_input", reason: "pricing?" }, "k1");
    expect(r.status).toBe("applied");
    expect(await store.get("run-1")).toMatchObject({ state: "needs_input", resume_to: "specified", seq: 1 });
    await store.apply(buildMachine, "run-1", { type: "resume", reason: "answered" }, "k2");
    expect((await store.history("run-1")).map((h) => `${h.from_state}->${h.to_state}`)).toEqual([
      "specified->needs_input",
      "needs_input->specified",
    ]);
  });

  it("does not apply the same idempotency key twice", async () => {
    const store = new WorkflowStore(db);
    await store.create(buildMachine, "run-1", "language-coach");
    const event = { type: "suspend", to: "blocked", reason: "x" } as const;
    expect((await store.apply(buildMachine, "run-1", event, "same")).status).toBe("applied");
    const again = await store.apply(buildMachine, "run-1", event, "same");
    expect(again.status).toBe("duplicate");
    expect(again.run.seq).toBe(1);
  });

  it("rejects transitions whose guards fail and records nothing", async () => {
    const store = new WorkflowStore(db);
    await store.create(buildMachine, "run-1", "language-coach");
    const r = await store.apply(buildMachine, "run-1", { type: "advance", to: "planned", ctx }, "k1");
    expect(r).toMatchObject({ status: "rejected", problems: ["task graph is empty"] });
    expect(await store.history("run-1")).toEqual([]);
  });

  it("detects a concurrent writer", async () => {
    const store = new WorkflowStore(db);
    await store.create(buildMachine, "run-1", "language-coach");
    // Simulate another controller advancing the run between our read and write.
    const realGet = store.get.bind(store);
    let first = true;
    store.get = (async (id: string) => {
      const run = await realGet(id);
      if (first) {
        first = false;
        await db.query("UPDATE workflow_runs SET seq = seq + 1 WHERE run_id = $1", [id]);
      }
      return run;
    }) as typeof store.get;
    const r = await store.apply(buildMachine, "run-1", { type: "cancel", reason: "x" }, "k1");
    expect(r.status).toBe("conflict");
  });

  it("is safe to create the same run twice", async () => {
    const store = new WorkflowStore(db);
    await store.create(buildMachine, "run-1", "language-coach");
    await expect(store.create(buildMachine, "run-1", "language-coach")).resolves.toMatchObject({ seq: 0 });
    await expect(store.create(buildMachine, "run-1", "other")).rejects.toThrow(/different parameters/);
  });
});
