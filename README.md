# AI Software Factory

A system that discovers consumer problems, validates demand, builds B2C subscription apps, and operates them. Specialist agent roles do the work under explicit budgets and permissions. The factory runs inside **Claude Code**: roles are subagents, the controller is the main session, and policy is enforced by hooks. State lives behind an MCP server.

- Product idea: [docs/idea.md](docs/idea.md)
- Reference architecture: [docs/architecture.md](docs/architecture.md)
- Decisions: [docs/decisions/](docs/decisions/), especially [ADR 0002](docs/decisions/0002-claude-code-as-the-harness.md)

## Quick start

Requires Node 22+, pnpm, and Claude Code.

```sh
pnpm setup:harness      # install and build the MCP server and hooks
claude                  # open Claude Code in this directory; approve the "factory" MCP server
```

Then, in Claude Code:

| Command | What happens |
|---|---|
| `/factory-discover learning 3` | Scouts 3 opportunities, records evidence from 3 angles each, writes briefs, has an independent skeptic review them, and designs experiments. Then it advances each opportunity as far as the evidence allows. |
| `/factory` | Shows status, carries out routine next steps, and asks you for authorizations and build/investigate/reject decisions. |

Set your token budget and boundaries first in [.factory/config.yaml](.factory/config.yaml). The default budget of 5M tokens is a placeholder. The factory uses your Claude Code subscription; it never calls the API or spends money on models.

## How it fits together

```text
you ──/factory, /factory-discover──▶ main session (controller)
                                        │  Workflow: factory-discovery-pipeline
                                        ▼
       subagents: demand-intelligence-lead · problem-evidence-analyst · demand-skeptic · experiment-designer
                                        │  mcp__factory__* tools only
                                        ▼
       factory MCP server ── contracts + guards ── embedded Postgres (.factory/state)
hooks: PreToolUse policy gate · SessionStart status · SubagentStop token counting
```

- **Policy** (`.factory/config.yaml`): `allow` defers to Claude Code permissions, `escalate` prompts you, and `deny` blocks. Build decisions, publishing, outreach, and production deploys escalate. Spending and payments are denied until you change the config.
- **Attribution**: every factory record names the role that produced it. The hook checks that against the actual subagent, and the server enforces which role may write what.
- **Guards**: an opportunity cannot become build-eligible without recorded evidence, an independent review, an authorized experiment with valid results, and your decision.

## Packages

| Package | What it does |
|---|---|
| `@factory/contracts` | Zod schemas for evidence, briefs, reviews, experiments, decisions, specifications, task contracts, policies, roles, verification, releases |
| `@factory/policy` | Deny-by-default policy evaluation and a hierarchical budget ledger |
| `@factory/workflow` | Replay-safe opportunity/build/repair state machines with evidence guards, task graph, retry policy, release gate |
| `@factory/control-plane` | PostgreSQL migrations and the workflow run store (idempotent, optimistic concurrency) |
| `@factory/harness` | Config, the policy gate, token accounting, and the Claude Code hook entry point |
| `@factory/mcp-server` | The `factory` MCP server: the only way agents change factory state |

## Development

```sh
pnpm check    # typecheck + all tests (database tests use in-process PGlite)
pnpm build    # rebuild after changing the server or hooks; restart Claude Code to reload the server
```

## Status and next steps

Done: contracts and cores (step 1 of [architecture.md §14](docs/architecture.md#14-initial-implementation-topology)), and the discovery pipeline running in Claude Code (step 2).

Next:
1. Choose the first consumer category and platform, then run `/factory-discover` on it.
2. Build path: specification owner, architect, and builder/tester subagents, plus spec, task-graph, verification, and release tools on the MCP server (steps 3–5).
3. Postgres server instead of embedded state, for concurrent sessions.
