# ADR 0003: Budget factory work in tokens, not notional dollars

Status: accepted
Date: 2026-10-23

## Context

[ADR 0002](0002-claude-code-as-the-harness.md) priced transcript token usage at API list prices and capped it with a dollar budget. The factory runs on the owner's Claude Code subscription, not an API key, so those dollars were never charged. Showing them read as real spending. The `Stop` hook also counted every main session in the repository, including development sessions, against the factory's budget.

## Decision

1. Usage is counted in tokens. There is no price table.
2. The budget counts input, output, and cache-write tokens. Cache reads re-read the same context on every turn and would dominate the total, so they are recorded and reported separately but do not count.
3. Only subagents whose `agent_type` is a role in `roles/catalog.yaml` are counted, through the `SubagentStop` hook. The `Stop` hook is removed, so main sessions, including the controller, are not counted.
4. `budgets.portfolio_tokens` caps factory work only. Once it is used up, the hook refuses `Agent` calls for catalog roles and `Workflow` calls named `factory-*`. Other subagents keep working.

Experiment budgets (`budget_usd_cents`) are unaffected. They are money an experiment may really spend, for example on ads.

## Consequences

- The cap limits how much research the factory does at once. It is not a cost estimate. Claude Code subscription limits still apply separately.
- Controller work in the main session is not budgeted. It is small next to the research subagents.
- Usage files written by the earlier dollar scheme are ignored.
