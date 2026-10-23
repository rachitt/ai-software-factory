# AI Software Factory: Product Idea

Status: implementation started; step 1 (contracts and cores) is complete. See [README](../README.md).

Last updated: October 23, 2026.

## Vision

Build an AI software factory that discovers promising consumer problems, validates demand, creates high-quality B2C subscription applications, and operates and improves them after launch.

The intended outcome is a repeatable production system: a product brief and supporting evidence enter the factory; a useful, tested, deployed, and maintainable application comes out. The factory should eventually manage a portfolio of products with limited routine human intervention.

The system spans the product lifecycle, including research, design, development, verification, release, analytics, growth experiments, and maintenance. It uses tens of specialist agent roles coordinated by durable software workflows.

## Product focus

The factory targets B2C applications serving individual consumers. Their foundations should support individual accounts, fast onboarding, saved progress, subscriptions, personalization, notifications, and retention measurement.

The first product category remains undecided. Learning, personal productivity, and similar consumer utilities are candidate starting points. Choose one category initially so the factory can reuse domain knowledge, experience patterns, components, and quality checks.

Web, iOS, and Android are possible targets. Each product must declare its platform. Platform-specific builds, purchases, testing, and releases require dedicated adapters; support for every platform is not an initial requirement.

## What the factory produces

A completed product includes:

- A documented audience, problem, value proposition, and business model.
- A complete core user journey and onboarding experience.
- A deployed application with working accounts, purchases, and entitlements where required.
- Responsive or platform-appropriate interfaces with accessible controls and complete screen states.
- Versioned source code, architecture decisions, and migration history.
- Independent verification evidence tied to the released version.
- Monitoring, support workflows, backup and recovery procedures.
- Product analytics and a prioritized improvement backlog.

Application code is one output among several. The factory also needs evidence that the application meets its specification and mechanisms to maintain it over time.

## Demand intelligence is a first-class capability

A Demand Intelligence Agent owns opportunity discovery and demand investigation. It can delegate narrow searches to specialist research workers and assemble their findings into an evidence-backed opportunity brief.

The research pipeline searches public discussions, reviews, competitor products, search-interest data where available, and existing workarounds. It looks for recurring problems, unsatisfactory paid alternatives, frequent manual effort, and underserved audiences.

Every meaningful finding should preserve its source, date, context, and relevant excerpt. The system must distinguish unique evidence from reposts, duplicate comments, promotional content, and repeated contributions by the same person.

Each opportunity brief identifies:

- The audience, triggering situation, problem, and current workaround.
- How frequently the problem occurs and what it costs users in time, money, or frustration.
- Competitors, substitutes, existing spending, and reasons someone might switch.
- A plausible acquisition route and the main economic assumptions.
- Supporting evidence, contradictory evidence, and unresolved uncertainty.
- The next experiment and the maximum investment justified by current evidence.

An independent demand reviewer challenges the recommendation. The factory should actively look for reasons an attractive idea might fail.

### Evidence stages

| Stage | Evidence available | What remains uncertain |
|---|---|---|
| Discovered | A plausible problem and initial sources | Whether the problem is widespread or valuable |
| Researched | Repeated, contextualized evidence from a defined audience | Whether people will act on an offer |
| Behavior tested | Observed responses to a clear offer or prototype | Whether interest becomes payment and repeat usage |
| Paid | Actual purchases or paid pilots | Whether acquisition, delivery, and retention work economically |
| Retained | Users continue receiving value over time | Whether results persist across larger cohorts and channels |

These stages communicate evidence strength rather than guaranteeing success. Signups, payments, and retention answer different questions.

Demand experiments can include interviews, landing pages, interactive prototypes, manually delivered services, paid pilots, and limited working products. Define the audience, success criteria, budget, and stopping conditions before execution. Outbound messages, publishing, paid campaigns, and transactions require the appropriate configured authorization.

## How the factory works

1. Discover and investigate an opportunity.
2. Test the largest uncertainty with an appropriately scoped experiment.
3. Decide to build, investigate further, or reject the opportunity.
4. Create a versioned product specification and acceptance criteria.
5. Design the core experience and its complete screen states.
6. Implement the product using a maintained consumer application foundation.
7. Independently verify functionality, experience, security, and operations.
8. Release according to policy and monitor the exact deployed version.
9. Use incidents and customer evidence to drive bounded improvements.

## Agent organization

The proposed organization contains 34 specialist roles across product coordination, discovery, experience, engineering, assurance, growth, and operations. The detailed role map is in [architecture.md](architecture.md).

Roles are reusable configurations with particular instructions, tools, permissions, and output contracts. They are instantiated when work is available. Several workers may execute one role, and many roles may be idle during a particular phase.

A durable workflow controller schedules their work, tracks dependencies, limits spending, and enforces release conditions. Product knowledge and evidence live in versioned stores so projects survive agent failures and context resets.

## Meaning of autopilot

Autopilot means routine work proceeds within explicit operating boundaries. Those boundaries cover budgets, environments, tool access, release categories, external communications, and production changes.

The factory should handle retries, interrupted builds, ordinary repairs, and eligible releases automatically. It should stop or escalate when evidence is missing, requirements conflict, spending limits are reached, or an action exceeds its authority. An unresolved run must remain visibly unresolved.

Engineering readiness and product readiness are separate decisions. Automated checks can establish much of technical correctness. Whether real consumers understand, value, pay for, and return to a product requires customer evidence.

## Quality principles

- Acceptance criteria are written before implementation and traced to verification evidence.
- Builders cannot silently weaken independent release requirements.
- Each product inherits versioned, maintained foundation modules.
- Releases are reproducible and tied to exact commits and artifacts.
- Every product has an upgrade and recovery path.
- Research claims carry provenance and uncertainty.
- Added agents must improve measured results enough to justify coordination and cost.

## Success measures

Measure both the factory and its products.

Factory measures include accepted requirements, escaped defects, human intervention, cost per accepted release, build completion time, recovery success, and maintenance effort.

Product measures include first-value completion, activation, cohort retention, paid conversion, refunds, cancellation, reliability, acquisition economics, and operating cost per active user. Define these measures for each product rather than imposing arbitrary universal thresholds.

## Initial milestone

Prove the system in one consumer category. It should produce three distinct applications from briefs, deliver a later feature to each, recover from an interrupted build, and propagate a foundation update across all three.

Retain a record of what passed automatically, what required intervention, what the builds cost, and what actual users did. Expand the product range and active agent capacity based on that evidence.

## Decisions still required

- Initial consumer category and target audience.
- First supported platform.
- Research and experiment budget.
- Runtime, model providers, hosting, identity, and payment services.
- Actions authorized to run automatically and exception owners.
- Product-specific acceptance and investment thresholds.

See [architecture.md](architecture.md) for system boundaries, agent roles, workflows, verification, and implementation stages.
