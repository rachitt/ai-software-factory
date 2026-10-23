/**
 * Valid sample contracts for tests across packages. Uses synthetic data only.
 */
import type { EvidenceRecord } from "./evidence.js";
import type { OpportunityBrief } from "./opportunity.js";
import type { ProductSpecification } from "./specification.js";

export const NOW = "2026-10-23T12:00:00Z";

export function evidence(id: string, overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    evidence_id: id,
    source: { kind: "public_discussion", uri: `https://forum.example/${id}` },
    retrieved_at: NOW,
    excerpt: "I keep forgetting vocabulary a week after every lesson.",
    audience_context: "adult language learners preparing for travel",
    claim: "Learners lose vocabulary without structured review",
    stance: "supports",
    limitations: ["single forum"],
    is_promotional: false,
    ...overrides,
  };
}

export function opportunityBrief(overrides: Partial<OpportunityBrief> = {}): OpportunityBrief {
  return {
    opportunity_id: "travel-vocab",
    version: 1,
    category: "learning",
    audience: "Adults learning a language for an upcoming trip",
    triggering_situation: "A trip is booked 4-12 weeks out",
    problem: "Vocabulary decays between lessons",
    current_workaround: { description: "Paper flashcards and generic apps", evidence_ids: ["ev-1"] },
    frequency: { description: "Daily study sessions", evidence_ids: ["ev-1"] },
    severity: { frustration: "Abandon study before the trip", evidence_ids: ["ev-2"] },
    alternatives: [{ name: "Generic flashcard app", kind: "competitor", evidence_ids: ["ev-3"] }],
    existing_spending: { description: "Pays for tutoring sessions", evidence_ids: ["ev-3"] },
    proposed_promise: "Learn the 500 phrases your trip needs, in time",
    differentiation: "Itinerary-driven phrase selection",
    switching_hypothesis: "Generic decks do not match the trip",
    acquisition_route: { channel: "Travel planning communities", rationale: "Audience gathers there pre-trip" },
    economic_assumptions: [{ assumption: "Willing to pay $8/month", confidence: "low", evidence_ids: [] }],
    supporting_evidence_ids: ["ev-1", "ev-2"],
    contradicting_evidence_ids: ["ev-4"],
    open_uncertainties: ["Whether travellers pay for a short-lived need"],
    evidence_stage: "researched",
    attractiveness: { score: 3, rationale: "Clear trigger, short lifetime" },
    confidence: { level: "low", rationale: "Forum evidence only" },
    next_investment_limit_usd_cents: 20_000,
    ...overrides,
  };
}

export function productSpecification(overrides: Partial<ProductSpecification> = {}): ProductSpecification {
  return {
    product_id: "language-coach",
    spec_version: 7,
    category: "learning",
    platform: "web",
    audience: "Adults learning a language for travel",
    core_promise: "Trip-ready phrases in four weeks",
    primary_journey: [
      { step_id: "arrive", description: "Land on the offer page" },
      { step_id: "onboard", description: "Enter destination and date as a guest" },
      { step_id: "first-lesson", description: "Complete the first phrase set" },
    ],
    first_value_event: "first_value_reached",
    return_reason: "Daily review reminders tied to the trip countdown",
    entities: [{ name: "PhraseProgress", description: "Per-user phrase review state", ownership: "user_owned" }],
    permissions: ["Users read and write only their own progress"],
    integrations: [],
    monetization: {
      model: "freemium_subscription",
      plans: [{ plan_id: "monthly", price_minor: 800, currency: "USD", interval: "month", trial_days: 7 }],
    },
    data_handling: {
      personal_data: ["email", "destination"],
      retention: "Deleted 30 days after account deletion",
      export_supported: true,
      deletion_supported: true,
    },
    nonfunctional_targets: [{ target_id: "p95-lesson-load", statement: "Lesson loads in under 1.5s at p95" }],
    exclusions: ["Speech recognition"],
    foundation_modules: ["identity", "consumer_experience", "commerce", "product_measurement", "design_system"],
    requirements: [
      {
        requirement_id: "guest-onboarding",
        statement: "Visitors can start as guests and keep progress when they register",
        priority: "must",
        verification_areas: ["functional", "experience"],
        acceptance_criteria: [
          {
            criterion_id: "guest_progress_survives_registration",
            given: "a guest who completed one lesson",
            when: "they create an account",
            then: "the completed lesson appears in their account",
          },
        ],
      },
      {
        requirement_id: "progress-isolation",
        statement: "Users cannot read other users' progress",
        priority: "must",
        verification_areas: ["access_control"],
        acceptance_criteria: [
          {
            criterion_id: "cross_user_progress_denied",
            given: "two users with progress",
            when: "user A requests user B's progress by id",
            then: "the request is rejected and nothing is returned",
          },
        ],
      },
      {
        requirement_id: "streak-badge",
        statement: "Show a streak badge",
        priority: "could",
        verification_areas: ["experience"],
        acceptance_criteria: [
          { criterion_id: "streak_badge_visible", given: "a 3-day streak", when: "home loads", then: "badge shows 3" },
        ],
      },
    ],
    open_questions: [],
    ...overrides,
  };
}
