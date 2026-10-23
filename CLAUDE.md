# CLAUDE.md

Read `docs/idea.md` and `docs/architecture.md` before substantial work; record significant choices as ADRs in `docs/decisions/`. The factory runs inside Claude Code; see ADR 0002 for how the pieces map.

## Commands

- `pnpm check` — typecheck and test everything; run before committing.
- `pnpm build` — required after changing `packages/harness` or `packages/mcp-server`, because hooks and `.mcp.json` run the compiled `dist/` files. Restart Claude Code to reload the MCP server.
- `pnpm vitest run packages/<name>` — test one package.

## Conventions

- Contracts live in `@factory/contracts` as Zod schemas with snake_case fields. Add a schema there before using a new document shape elsewhere.
- Code in `@factory/workflow` must stay deterministic: no `Date.now()`, randomness, IO, or network. Pass time and data in.
- Policy is enforced in code (hooks and the MCP server), never by prompt instructions. New gated actions go in `ActionKind`, default to deny, and get a rule in `.factory/config.yaml`.
- Factory state changes only through `mcp__factory__*` tools. A new kind of record needs a contract, a service method with a `ROLE_GRANTS` entry, a tool, and a test.
- A subagent's file name, `name`, and the `actor_role` it passes must all equal its role id in `roles/catalog.yaml`.
- Versioned records (specs, briefs, experiments, verification results, releases, transitions) are immutable. Add a new version instead of updating.
- Money is integer US cents (`UsdCents`).
- Shared test fixtures are in `@factory/contracts/testing`; use synthetic data only.
- Schema changes are new numbered files in `packages/control-plane/migrations/`; never edit an applied migration.
