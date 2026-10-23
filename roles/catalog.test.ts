import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { duplicates, RoleCatalog, type Team } from "@factory/contracts";

const catalog = RoleCatalog.parse(parse(readFileSync(new URL("./catalog.yaml", import.meta.url), "utf8")));

/** Parses the team table in docs/architecture.md §2 into team → count. */
function documentedCounts(): Record<string, number> {
  const doc = readFileSync(new URL("../docs/architecture.md", import.meta.url), "utf8");
  const counts: Record<string, number> = {};
  for (const [, team, count] of doc.matchAll(/^\| ([A-Z][a-z ]+) \| (\d+) \|/gm)) {
    counts[team!.toLowerCase().replaceAll(" ", "_")] = Number(count);
  }
  return counts;
}

describe("role catalog", () => {
  it("has unique role ids", () => {
    expect(duplicates(catalog.roles.map((r) => r.role_id))).toEqual([]);
  });

  it("matches the team table in architecture.md", () => {
    const counts: Partial<Record<Team, number>> = {};
    for (const r of catalog.roles) counts[r.team] = (counts[r.team] ?? 0) + 1;
    expect(counts).toEqual(documentedCounts());
    expect(catalog.roles).toHaveLength(34);
  });

  it("marks every assurance role and the demand skeptic as independent", () => {
    for (const r of catalog.roles.filter((r) => r.team === "assurance")) expect(r.independent, r.role_id).toBe(true);
    expect(catalog.roles.find((r) => r.role_id === "demand-skeptic")?.independent).toBe(true);
  });
});
