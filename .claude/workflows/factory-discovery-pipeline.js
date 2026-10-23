export const meta = {
  name: 'factory-discovery-pipeline',
  description: 'Factory discovery: scout opportunities in a consumer category, gather evidence, write briefs, skeptic-review them, and design experiments',
  whenToUse: 'Started by the /factory-discover skill with args {category, count, focus}',
  phases: [
    { title: 'Scout', detail: 'demand-intelligence-lead registers candidate opportunities' },
    { title: 'Research', detail: 'problem-evidence-analysts record evidence from three angles per opportunity' },
    { title: 'Brief', detail: 'demand-intelligence-lead writes a brief from recorded evidence' },
    { title: 'Review', detail: 'demand-skeptic challenges each brief independently' },
    { title: 'Design', detail: 'experiment-designer defines the cheapest decisive experiment' },
  ],
}

// All durable state goes through the factory MCP server; agents return only
// small summaries here. The controller (main session) advances workflow states
// after this returns.

const category = args && args.category
if (!category) throw new Error('args.category is required, e.g. {"category": "learning"}')
const count = Math.max(1, Math.min(6, (args && args.count) || 3))
const focus = (args && args.focus) || ''

const ANGLES = [
  { key: 'discussions', brief: 'public discussions (forums, Reddit, Q&A sites): people describing the problem, how often it happens, and what it costs them' },
  { key: 'reviews', brief: 'app store and product reviews of existing solutions: complaints, unmet needs, reasons people quit or switch' },
  { key: 'alternatives', brief: 'competitors, substitutes, and workarounds: what people use today, what they pay, and evidence that they would or would not switch' },
]

const SCOUT = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          opportunity_id: { type: 'string' },
          audience: { type: 'string' },
          problem: { type: 'string' },
          why_promising: { type: 'string' },
        },
        required: ['opportunity_id', 'audience', 'problem', 'why_promising'],
      },
    },
  },
  required: ['candidates'],
}

const RESEARCH = {
  type: 'object',
  properties: {
    evidence_ids: { type: 'array', items: { type: 'string' } },
    supporting: { type: 'number' },
    contradicting: { type: 'number' },
    notable: { type: 'string' },
  },
  required: ['evidence_ids', 'supporting', 'contradicting', 'notable'],
}

const BRIEF = {
  type: 'object',
  properties: {
    submitted: { type: 'boolean' },
    brief_version: { type: 'number' },
    attractiveness: { type: 'number' },
    confidence: { type: 'string' },
    biggest_uncertainty: { type: 'string' },
    error: { type: 'string' },
  },
  required: ['submitted', 'biggest_uncertainty'],
}

const REVIEW = {
  type: 'object',
  properties: {
    submitted: { type: 'boolean' },
    recommendation: { type: 'string', enum: ['proceed', 'investigate_further', 'reject'] },
    weakest_assumption: { type: 'string' },
    error: { type: 'string' },
  },
  required: ['submitted', 'recommendation', 'weakest_assumption'],
}

const DESIGN = {
  type: 'object',
  properties: {
    submitted: { type: 'boolean' },
    experiment_id: { type: 'string' },
    method: { type: 'string' },
    required_authorizations: { type: 'array', items: { type: 'string' } },
    budget_usd_cents: { type: 'number' },
    error: { type: 'string' },
  },
  required: ['submitted'],
}

phase('Scout')
const scout = await agent(
  `Scout the "${category}" consumer category for the AI software factory.${focus ? ` Focus: ${focus}.` : ''}
Find ${count} distinct, narrow consumer problems that could support a subscription app, register each with opportunity_create (category "${category}"), and record the strongest sources you used as evidence.
Return the candidates you registered.`,
  { agentType: 'demand-intelligence-lead', schema: SCOUT, phase: 'Scout', label: `scout:${category}` },
)
const candidates = ((scout && scout.candidates) || []).slice(0, count)
if (scout && scout.candidates.length > count) log(`Scout returned ${scout.candidates.length} candidates; researching the first ${count}.`)
if (!candidates.length) return { category, opportunities: [], note: 'Scout registered no candidates.' }
log(`Researching ${candidates.length} opportunities: ${candidates.map((c) => c.opportunity_id).join(', ')}`)

const results = await pipeline(
  candidates,
  (c) =>
    parallel(
      ANGLES.map((a) => () =>
        agent(
          `Opportunity "${c.opportunity_id}" (category "${category}"): ${c.problem} — audience: ${c.audience}.
Your search angle: ${a.brief}.
Record evidence for this opportunity with evidence_add.`,
          { agentType: 'problem-evidence-analyst', schema: RESEARCH, phase: 'Research', label: `research:${c.opportunity_id}:${a.key}` },
        ),
      ),
    ),
  (research, c) => {
    const recorded = research.filter(Boolean).reduce((n, r) => n + r.evidence_ids.length, 0)
    return agent(
      `Write the opportunity brief for "${c.opportunity_id}" (category "${category}") from the evidence recorded in the factory (${recorded} records were just added by analysts). Submit it with brief_submit.`,
      { agentType: 'demand-intelligence-lead', schema: BRIEF, phase: 'Brief', label: `brief:${c.opportunity_id}` },
    ).then((brief) => ({ recorded, brief }))
  },
  (prev, c) => {
    if (!prev.brief || !prev.brief.submitted) return { ...prev, review: null }
    return agent(
      `Independently review brief v${prev.brief.brief_version} of opportunity "${c.opportunity_id}" and submit your review with review_submit.`,
      { agentType: 'demand-skeptic', schema: REVIEW, phase: 'Review', label: `skeptic:${c.opportunity_id}` },
    ).then((review) => ({ ...prev, review }))
  },
  (prev, c) => {
    if (!prev.review || !prev.review.submitted || prev.review.recommendation === 'reject') return { ...prev, design: null }
    return agent(
      `Design the experiment for opportunity "${c.opportunity_id}" that resolves its largest uncertainty, and define it with experiment_define.`,
      { agentType: 'experiment-designer', schema: DESIGN, phase: 'Design', label: `design:${c.opportunity_id}` },
    ).then((design) => ({ ...prev, design }))
  },
)

return {
  category,
  opportunities: candidates.map((c, i) => ({
    opportunity_id: c.opportunity_id,
    problem: c.problem,
    audience: c.audience,
    evidence_recorded: results[i] ? results[i].recorded : 0,
    brief: results[i] ? results[i].brief : null,
    review: results[i] ? results[i].review : null,
    design: results[i] ? results[i].design : null,
    failed: !results[i],
  })),
}
