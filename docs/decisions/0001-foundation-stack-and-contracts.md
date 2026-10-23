# ADR 0001: Foundation stack and contract-first start

Status: accepted
Date: 2026-10-23

## Context

[architecture.md §14](../architecture.md#14-initial-implementation-topology) proposes a TypeScript stack with PostgreSQL and Temporal, and sequences implementation starting with the product, task, evidence, and policy contracts. Several selection decisions remain open (consumer category, first platform, model providers, hosting, identity, payments).

## Decision

1. **Monorepo:** pnpm workspaces, TypeScript (strict, `exactOptionalPropertyTypes`), Vitest. Packages are logical boundaries inside one modular control plane, not microservices.
2. **Contracts as Zod schemas** (`@factory/contracts`). Field names are snake_case to match the YAML and JSON documents that agents and humans author. The `architecture.md` task example is parsed verbatim in a test so docs and code cannot drift.
3. **Money as integer US cents** for internal budgets and costs. Consumer prices in specifications carry their own currency.
4. **Engine-agnostic workflow core** (`@factory/workflow`). State machines, guards, retry policy, task graph, and release gate are pure functions with no clock, randomness, or IO, so they can run inside Temporal workflow code (deterministic replay) or any other durable engine. Temporal integration is deferred until step 4; the CLI is not yet installed locally.
5. **Policy defaults to deny** (`@factory/policy`). Deny beats escalate beats allow across portfolio and product policies; exceeding a spend cap escalates. Budgets are reserved hierarchically (portfolio → product → run → task) with idempotent reservation keys; worker concurrency is bounded the same way.
6. **PostgreSQL metadata schema** (`@factory/control-plane`) with versioned records (briefs, experiments, specifications, verification results, releases, transitions) made immutable by triggers. Workflow runs are an idempotent projection with optimistic concurrency. Tests run against real Postgres via PGlite, so no local server is required.

## Consequences

- Steps 2–4 can build on stable, tested contracts without choosing the open vendors yet.
- The in-memory `BudgetLedger` must be ported to the `budget_limits` / `budget_reservations` tables before workers run concurrently.
- Choosing Temporal (or another engine) later means writing activity wrappers, not rewriting the state machines.
