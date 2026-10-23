---
name: factory-discover
description: Run the AI software factory's discovery pipeline on a consumer category - scout opportunities, gather evidence, write briefs, skeptic review, and experiment design - then advance each opportunity as far as its evidence allows.
argument-hint: <category> [count] [focus...]
disable-model-invocation: true
---

# Factory discovery run

Arguments: `$ARGUMENTS` — the first word is the category slug (e.g. `learning`, `personal-productivity`), an optional number is how many opportunities to research (default 3, max 6), and any remaining words are a focus.

You are the factory controller. Pass `actor_role: "controller"` on every factory tool call.

1. **Preflight.** Call `mcp__factory__status`. If spend is at or near the budget, stop and tell the owner how much is left; do not start. If the factory MCP server is unavailable, tell the owner to run `pnpm setup:harness` and approve the `factory` server, then stop.
2. **Run the pipeline.** Run the saved workflow `factory-discovery-pipeline` with the Workflow tool, passing `args` as an object: `{"category": "<slug>", "count": <n>, "focus": "<text or empty>"}`. The owner invoking this skill is the opt-in for that workflow.
3. **Advance what the evidence supports.** For each returned opportunity, call `mcp__factory__opportunity_advance` to `researched`, then to `experiment_ready`. Stop at the first refusal and keep its reason; refusals are expected when evidence is thin.
4. **Report.** Call `mcp__factory__status`, then give the owner a table: opportunity, state, attractiveness, confidence, skeptic recommendation, proposed experiment (method, budget, required authorizations), and the refusal reason if it stalled. Below the table, list what needs the owner: experiments to authorize and briefs the skeptic recommended rejecting. Do not authorize or decide anything yourself; suggest `/factory` to continue.
