import { PGlite } from "@electric-sql/pglite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "@factory/control-plane";
import { factoryPaths, loadConfig } from "@factory/harness";
import { evidence, opportunityBrief } from "@factory/contracts/testing";
import { FactoryService, registerTools, type BriefInput, type EvidenceInput, type ExperimentInput } from "./index.js";

const config = loadConfig(factoryPaths(new URL("../../..", import.meta.url).pathname));
let db: PGlite;
let factory: FactoryService;
let clock = 0;

beforeEach(async () => {
  db = new PGlite();
  await migrate(db);
  clock = 0;
  factory = new FactoryService({
    db,
    config: () => config,
    now: () => new Date(Date.UTC(2026, 9, 23, 12, 0, clock++)).toISOString(),
  });
});
afterEach(async () => {
  await db.close();
});

const LEAD = "demand-intelligence-lead";
const ANALYST = "problem-evidence-analyst";
const SKEPTIC = "demand-skeptic";
const DESIGNER = "experiment-designer";
const CONTROLLER = "controller";

function ev(n: number, overrides: Partial<EvidenceInput> = {}): EvidenceInput {
  const { evidence_id: _id, retrieved_at: _at, ...rest } = evidence(`x-${n}`, { source: { kind: "public_discussion", uri: `https://forum.example/t/${n}` } });
  return { ...rest, ...overrides };
}

function brief(ids: string[]): BriefInput {
  const { version: _v, ...b } = opportunityBrief();
  const [a, b2, c, d] = ids as [string, string, string, string];
  return {
    ...b,
    current_workaround: { ...b.current_workaround, evidence_ids: [a] },
    frequency: { ...b.frequency, evidence_ids: [a] },
    severity: { ...b.severity, evidence_ids: [b2] },
    alternatives: [{ name: "Generic flashcard app", kind: "competitor", evidence_ids: [c] }],
    existing_spending: { ...b.existing_spending, evidence_ids: [c] },
    supporting_evidence_ids: [a, b2],
    contradicting_evidence_ids: [d],
    next_experiment_id: "landing-1",
  };
}

const experiment: ExperimentInput = {
  experiment_id: "landing-1",
  opportunity_id: "travel-vocab",
  hypothesis: "At least 4% of visitors join the paid waitlist",
  uncertainty_addressed: "Willingness to pay",
  method: "landing_page",
  audience: "Travel forum visitors",
  offer: "Trip-ready phrases, $8/month",
  channel: "Community post",
  measurement: { primary_metric: "waitlist_rate", success_threshold: ">= 0.04", minimum_sample: 300 },
  guardrails: ["No misleading claims"],
  budget_usd_cents: 10_000,
  stopping_conditions: ["14 days elapsed"],
  required_authorizations: ["publish_content"],
};

async function researched(): Promise<string[]> {
  await factory.createOpportunity({ opportunity_id: "travel-vocab", category: "learning" }, LEAD);
  const added = await factory.addEvidence("travel-vocab", [1, 2, 3].map((n) => ev(n)), ANALYST);
  const [contra] = await factory.addEvidence("travel-vocab", [ev(4, { stance: "contradicts" })], SKEPTIC);
  const ids = [...added.map((a) => a.evidence_id), contra!.evidence_id];
  await factory.submitBrief(brief(ids), LEAD);
  await factory.advanceOpportunity("travel-vocab", "researched", CONTROLLER);
  return ids;
}

describe("discovery lifecycle", () => {
  it("runs from discovery to a build-eligible opportunity with evidence at each step", async () => {
    const ids = await researched();

    await factory.submitReview(
      {
        opportunity_id: "travel-vocab",
        brief_version: 1,
        failure_modes: [{ description: "Need ends when the trip ends", severity: "major", evidence_ids: [ids[3]!] }],
        assumption_challenges: [{ assumption: "Pays $8/month", challenge: "No spending evidence", verdict: "untested" }],
        additional_evidence_ids: [ids[3]!],
        recommendation: "proceed",
        rationale: "Worth a cheap landing-page test",
      },
      SKEPTIC,
    );
    await factory.defineExperiment(experiment, DESIGNER);
    await factory.advanceOpportunity("travel-vocab", "experiment_ready", CONTROLLER);

    await expect(factory.advanceOpportunity("travel-vocab", "experimenting", CONTROLLER)).rejects.toThrow(
      /requires publish_content authorization/,
    );
    const auth = await factory.authorizeExperiment(
      { experiment_id: "landing-1", actions: ["publish_content"], budget_usd_cents: 10_000 },
      CONTROLLER,
    );
    expect(auth.granted).toEqual([{ action: "publish_content", via: "owner_approval" }]);
    await factory.advanceOpportunity("travel-vocab", "experimenting", CONTROLLER);

    const result = {
      experiment_id: "landing-1",
      participants: { real: 40, synthetic: 0 },
      primary_metric_value: 0.1,
      outcome: "success" as const,
      sample_limitations: [],
      evidence_ids: [],
      spent_usd_cents: 4_000,
    };
    await expect(factory.recordExperimentResult(result, DESIGNER)).rejects.toThrow(/must be inconclusive/);
    await factory.recordExperimentResult({ ...result, participants: { real: 320, synthetic: 0 }, primary_metric_value: 0.05 }, DESIGNER);

    expect((await factory.status()).attention).toEqual(["travel-vocab: owner: decide build, investigate further, or reject"]);
    await factory.recordDecision(
      { opportunity_id: "travel-vocab", decision: "build", rationale: "Beat threshold", max_investment_usd_cents: 50_000 },
      CONTROLLER,
    );
    await factory.advanceOpportunity("travel-vocab", "build_eligible", CONTROLLER);

    const dossier = await factory.getOpportunity("travel-vocab");
    expect(dossier.state).toBe("build_eligible");
    expect(dossier.next_step).toBeUndefined();
    expect(dossier.history.map((h) => h.to_state)).toEqual(["researched", "experiment_ready", "experimenting", "build_eligible"]);
    expect(dossier.decisions[0]).toMatchObject({ decision: "build", review_id: expect.any(String), experiment_ids: ["landing-1"] });
  });

  it("refuses to advance without the evidence the guard needs, and says what is missing", async () => {
    await factory.createOpportunity({ opportunity_id: "travel-vocab", category: "learning" }, CONTROLLER);
    await expect(factory.advanceOpportunity("travel-vocab", "researched", CONTROLLER)).rejects.toThrow(/missing brief/);
    await expect(factory.advanceOpportunity("travel-vocab", "build_eligible", CONTROLLER)).rejects.toThrow(/not a permitted transition/);
  });
});

describe("role boundaries", () => {
  it("only lets each role produce its own kind of record", async () => {
    await expect(factory.createOpportunity({ opportunity_id: "x", category: "learning" }, SKEPTIC)).rejects.toThrow(
      /may not opportunity create/,
    );
    await researched();
    await expect(factory.advanceOpportunity("travel-vocab", "experiment_ready", LEAD)).rejects.toThrow(/may not opportunity advance/);
    await expect(
      factory.recordDecision({ opportunity_id: "travel-vocab", decision: "reject", rationale: "x", max_investment_usd_cents: 0 }, LEAD),
    ).rejects.toThrow(/may not decision record/);
  });

  it("rejects briefs that cite unrecorded evidence", async () => {
    await factory.createOpportunity({ opportunity_id: "travel-vocab", category: "learning" }, LEAD);
    await expect(factory.submitBrief(brief(["ev-1", "ev-2", "ev-3", "ev-4"]), LEAD)).rejects.toThrow(/not recorded: ev-1/);
  });

  it("does not store the same source and excerpt twice", async () => {
    await factory.createOpportunity({ opportunity_id: "travel-vocab", category: "learning" }, LEAD);
    const first = await factory.addEvidence("travel-vocab", [ev(1)], ANALYST);
    const again = await factory.addEvidence("travel-vocab", [ev(1), ev(2)], LEAD);
    expect(again[0]).toEqual({ evidence_id: first[0]!.evidence_id, status: "already_recorded" });
    expect(again[1]!.status).toBe("added");
  });

  it("denies experiment actions that policy forbids", async () => {
    await researched();
    await factory.defineExperiment({ ...experiment, required_authorizations: ["spend_money"] }, DESIGNER);
    await expect(
      factory.authorizeExperiment({ experiment_id: "landing-1", actions: ["spend_money"], budget_usd_cents: 10_000 }, CONTROLLER),
    ).rejects.toThrow(/policy denies spend_money/);
    await expect(
      factory.authorizeExperiment({ experiment_id: "landing-1", actions: [], budget_usd_cents: 10_000 }, CONTROLLER),
    ).rejects.toThrow(/must match experiment v1/);
  });
});

describe("MCP surface", () => {
  it("lists the factory tools and returns errors as tool errors", async () => {
    const server = new McpServer({ name: "factory", version: "test" });
    registerTools(server, factory);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(clientSide);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "brief_submit",
      "decision_record",
      "evidence_add",
      "experiment_authorize",
      "experiment_define",
      "experiment_result_record",
      "get_contract_schema",
      "get_opportunity",
      "opportunity_advance",
      "opportunity_create",
      "review_submit",
      "run_control",
      "status",
    ]);

    const denied = await client.callTool({
      name: "opportunity_create",
      arguments: { actor_role: SKEPTIC, opportunity_id: "x", category: "learning" },
    });
    expect(denied.isError).toBe(true);

    const schema = await client.callTool({ name: "get_contract_schema", arguments: { name: "brief" } });
    expect(JSON.parse((schema.content as Array<{ text: string }>)[0]!.text).required).toContain("supporting_evidence_ids");
    await client.close();
  });
});
