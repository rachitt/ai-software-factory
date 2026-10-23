# AI Software Factory

A system that discovers consumer problems, validates demand, builds B2C subscription apps, and operates them, with specialist agent roles coordinated by durable workflows under explicit budgets and permissions.

- Product idea: [docs/idea.md](docs/idea.md)
- Reference architecture: [docs/architecture.md](docs/architecture.md)
- Decisions: [docs/decisions/](docs/decisions/)

## Status

Implementation step 1 of 8 ([architecture.md §14](docs/architecture.md#14-initial-implementation-topology)) is in place: the product, task, evidence, and policy contracts, plus the workflow, policy, and persistence cores they feed.

| Package | What it does |
|---|---|
| `@factory/contracts` | Zod schemas for evidence, opportunity briefs, skeptic reviews, experiments, investment decisions, product specifications, task contracts, policies, roles, verification results, findings, and release manifests |
| `@factory/policy` | Deny-by-default action evaluation and a hierarchical budget ledger (USD and worker slots) |
| `@factory/workflow` | Replay-safe opportunity / build / repair state machines with evidence guards, task dependency graph, retry policy, and the release gate |
| `@factory/control-plane` | PostgreSQL schema and migrations, and a workflow run store with idempotency and optimistic concurrency |
| `roles/catalog.yaml` | The 34-role catalog, with the initial active subset marked |

## Development

```sh
pnpm install
pnpm test        # vitest; database tests use PGlite (in-process Postgres)
pnpm typecheck   # tsc -b across all packages
pnpm check       # both
```

Requires Node 22+ and pnpm.

## Next steps

1. **Demand research (step 2):** model access layer with cost and version recording, source adapters, demand-intelligence and skeptic roles producing `OpportunityBrief` and `SkepticReview`.
2. Persist the budget ledger and policies in Postgres; add a tool gateway that calls `evaluate` before every gated action.
3. Choose the first consumer category and platform, then harden the consumer app foundation (step 3).
