# ADR 0002: Claude Code is the factory harness

Status: accepted
Date: 2026-10-23

## Context

The owner wants the factory to run from inside Claude Code rather than as a separate service calling a model API. [architecture.md](../architecture.md) assumes an agent execution plane, a durable controller, a tool gateway that enforces policy, and a model access layer that records cost. Claude Code already provides an agent loop, subagents, deterministic multi-agent workflows, hooks, permissions, and MCP.

## Decision

Map the architecture's planes onto Claude Code:

| Architecture concept | Claude Code mechanism |
|---|---|
| Specialist roles | Subagents in `.claude/agents/<role-id>.md`; `tools:` limits each role to its own factory tools |
| Workflow controller | The main session, driven by the `/factory` and `/factory-discover` skills |
| Parallel task execution | Saved workflow `.claude/workflows/factory-discovery-pipeline.js` (deterministic fan-out by role) |
| Control plane and state | `factory` MCP server (`@factory/mcp-server`) over embedded Postgres in `.factory/state/` |
| Tool gateway / policy enforcement | `PreToolUse` hook (`@factory/harness`) evaluating `.factory/config.yaml` |
| Continuity across context resets | `SessionStart` hook injects the status snapshot |
| Model access layer (cost) | `SubagentStop` and `Stop` hooks price transcript token usage |

Rules that follow from this:

1. **State changes only through the MCP server.** Each write is validated against the contracts. The server assigns ids, versions, and timestamps. Workflow guards read stored records; callers never supply guard evidence.
2. **Attribution is checked outside the model.** Each factory write carries `actor_role`. The hook requires it to equal the subagent name Claude Code reports (`agent_type`), or `controller` for the main session. The server's `ROLE_GRANTS` decides which role may produce each record. For example, only `demand-skeptic` submits reviews, and a brief's author cannot review it.
3. **Policy maps onto permissions.** A policy `allow` defers to Claude Code's normal permission flow, so factory policy can only narrow it. `escalate` becomes a permission prompt to the owner, and `deny` blocks the call. Build decisions and experiment authorizations are escalated by default. The gate fails closed when the config is missing or invalid.
4. **Budgets are notional API-equivalent spend.** They are computed from transcript usage and the price table in config. When the portfolio budget is spent, the hook refuses new subagents and workflows.
5. **Engine-agnostic cores are unchanged.** `@factory/workflow` remains pure and replay-safe. Claude Code is one execution plane; the contracts and guards do not depend on it.

## Consequences

- No API key or separate model integration is needed; models are chosen per subagent through Claude Code.
- Embedded Postgres allows one open session at a time (a lock file enforces this). Running several Claude Code sessions concurrently needs a real Postgres server later.
- Escalations rely on Claude Code permission prompts. In modes that auto-approve prompts (for example `bypassPermissions`), escalated actions would not reach the owner. Run the factory in a mode that shows prompts.
- Usage covers subagents and the main session. Workflow-internal agents are captured only to the extent `SubagentStop` fires for them.
- External side effects (publishing, messaging, payments) are not automated yet. Experiments are authorized in the factory and carried out with the owner.
