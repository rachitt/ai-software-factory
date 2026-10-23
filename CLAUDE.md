# CLAUDE.md

Read `docs/idea.md` and `docs/architecture.md` before substantial work; record significant choices as ADRs in `docs/decisions/`.

## Commands

- `pnpm check` — typecheck and test everything; run before committing.
- `pnpm vitest run packages/<name>` — test one package.

## Conventions

- Contracts live in `@factory/contracts` as Zod schemas with snake_case fields. Add a schema there before using a new document shape elsewhere.
- Code in `@factory/workflow` must stay deterministic: no `Date.now()`, randomness, IO, or network. Pass time and data in.
- Policy is enforced in code, never by prompt instructions. New gated actions go in `ActionKind` and default to deny.
- Versioned records (specs, briefs, experiments, verification results, releases, transitions) are immutable. Add a new version instead of updating.
- Money is integer US cents (`UsdCents`).
- Shared test fixtures are in `@factory/contracts/testing`; use synthetic data only.
- Schema changes are new numbered files in `packages/control-plane/migrations/`; never edit an applied migration.
