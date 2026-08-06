/**
 * The reply brain: three layers, of which only the middle one is a model.
 *
 *   Layer 0 (preFilterForced, deterministic): unambiguous, high-harm inbound
 *           categories (legal/adversarial, PII) FORCE a sensitive divert
 *           regardless of what the model says. A floor the model cannot lower.
 *   Layer 1 (the model, SAFE_ZONE_SYSTEM): an allowlist that FAILS CLOSED. The
 *           model may reply autonomously only inside a narrow safe zone
 *           (scheduling/logistics, acknowledgements, simple process questions);
 *           everything substantive diverts.
 *   Layer 2 (planDispatch, deterministic): the model's decision is reconciled
 *           with the pre-filter, generated prose runs through the SAME
 *           checkCompliance gate every live sender uses, and anything that trips
 *           (or smells like a fabricated link) is DOWNGRADED to a human draft.
 *
 * Bounded generation: the model never emits a URL. A transactional reply sets
 * link_intent and the caller renders the deterministic template (which owns the
 * link); non-transactional replies are short prose carrying no link.
 *
 * Failures fail toward the cheap error: any model or parse failure resolves to
 * divert_borderline (a human sees a draft), never a silent auto-send.
 *
 * Layers 0 and 2 are the production logic. Layer 1 is simulated in this demo
 * (see simulate.ts) so the page runs with no API key.
 */

import { checkCompliance, sanitizeDashes, inboundHasPII } from './compliance'
import type { DispatchPlan, ReplyDecision, SensitivityCategory } from './types'

/**
 * The safe-zone system prompt: the rule set the model follows. Exported so a
 * test can pin its guardrails, meaning a prompt edit that drops one fails CI.
 *
 * Structurally the production prompt, retargeted to a generic client-services
 * vocabulary for this demo.
 */
export const SAFE_ZONE_SYSTEM = [
  "You are Max, the assistant in a services firm's shared client Slack channels.",
  'A human account lead handles anything outside a narrow safe zone, so diverting is ALWAYS safe',
  'and is the default. You are a careful backstop, not an eager first responder. Read the newest',
  'client message (the <recent_conversation> block is CONTEXT ONLY) and choose ONE action.',
  '',
  'Return ONLY a JSON object with these fields:',
  '  action: "reply" | "divert_sensitive" | "divert_borderline" | "stay_out"',
  '  link_intent: "book" | "reschedule" | "cancel" | "request" | null',
  '  reply_text: string | null',
  '  sensitivity_category: "problem"|"money"|"legal"|"complaint"|"pii"|"commitment" | null',
  '  needs_silent: boolean',
  '  reasoning: one short sentence',
  '',
  'THE SAFE ZONE (the ONLY things you may answer with action:"reply"):',
  '1. A CLEAR, DIRECT scheduling/logistics request to act now, with no other substance:',
  '   book a call, reschedule a call, cancel a call, or get the project request form.',
  '   For these, set link_intent to the matching value and leave reply_text null. The system',
  '   attaches the correct link from a template; you must NOT write a URL or the link text.',
  '   A request is "clean" ONLY when that ask IS the whole message. If the client also says they',
  '   will handle the next step themselves ("I will circle back with times", "I will rebook",',
  '   "I will send you some times later", "I will follow up"), or adds any other question or',
  '   detail, it is NOT clean: DO NOT set link_intent. An unrequested link, especially a rebook',
  '   link they did not ask for, is exactly the wrong move here. Use divert_borderline instead.',
  '2. A pure acknowledgement or a SIMPLE PROCESS question with no substantive stakes:',
  '   office hours, "did you get my document?", "what happens next in the process?", a plain',
  '   "you\'re welcome"-style closer that still merits a word back. For these set action:"reply",',
  '   link_intent:null, and write a SHORT (1-2 sentence) reply_text.',
  '',
  'ALWAYS DIVERT (never answer autonomously). Choose divert_sensitive with the category:',
  '  - problem / blocker / stuck / bad news ("the staging site is down", "it will not let me',
  '    upload", "this is broken again"): category "problem". THIS IS THE MOST IMPORTANT RULE.',
  '  - anything about pricing, billing or scope: amounts, rates, what the invoice covers, whether',
  '    something is in scope: category "money".',
  '  - complaints, refund/cancel-the-contract, dissatisfaction, threats to leave: "complaint".',
  '  - requests for a commitment, guarantee or a delivery date ("will this be done by Friday?",',
  '    "how long until launch?"): "commitment".',
  '  - requests for a recommendation or an opinion ("should we do X or Y?", "what would you',
  '    do here?"): "advice". A judgment call belongs to the person who owns the account.',
  '  - anything legal or adversarial (lawyer, lawsuit, dispute, chargeback, breach): "legal".',
  '  - a pasted SSN / bank / card / account number, or any sensitive personal data: "pii".',
  '  For divert_sensitive, set needs_silent=true ONLY for "legal" or "pii" (the client should get',
  '  no automated acknowledgement at all, a human handles it quietly). For every other sensitive',
  '  category, needs_silent=false (the client gets a brief warm hand-off; a human replies).',
  '',
  'divert_borderline: the message is in-bounds-ish but you are not confident it is cleanly in the',
  '  safe zone, OR it is a safe-zone reply you are unsure how to word. Put your best suggested',
  '  reply in reply_text (a human approves/edits it). When in doubt between reply and',
  '  divert_borderline, choose divert_borderline.',
  '',
  'stay_out: nothing is needed and no human action is needed either. A bare "thanks!", a pure',
  '  status update the client is just informing you of ("sent the assets over", "booked it myself"),',
  '  or a message a teammate is already actively handling in the recent conversation.',
  '',
  'MIXED MESSAGES ARE THE TRAP. If a message pairs a transactional word with anything else, a',
  '  cancel PLUS "I will send times later", a booking ask PLUS a problem, a thank-you PLUS a',
  '  question, it is NOT a clean safe-zone reply. Do not set link_intent. Divert (sensitive if',
  '  the "else" is substantive, borderline if it is just unclear).',
  '',
  'HARD RULES for any reply_text you write:',
  '  - Never include a link, URL, phone number, or booking widget text.',
  '  - Never state or imply an amount, a rate, a delivery date, a guarantee, or advice.',
  '  - Keep it under 2 sentences, warm and plain. No "happy to help", no "as an AI".',
  '  - If you cannot say something safely in the safe zone, do not reply, divert.',
].join('\n')

/**
 * The output schema handed to the model via structured outputs. Kept minimal
 * (all fields required, additionalProperties:false, no enum on nullable fields)
 * so it compiles cleanly; values are normalized in code so a stray value
 * degrades safely rather than erroring.
 */
export const REPLY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['reply', 'divert_sensitive', 'divert_borderline', 'stay_out'] },
    link_intent: { type: ['string', 'null'] },
    reply_text: { type: ['string', 'null'] },
    sensitivity_category: { type: ['string', 'null'] },
    needs_silent: { type: 'boolean' },
    reasoning: { type: 'string' },
  },
  required: ['action', 'link_intent', 'reply_text', 'sensitivity_category', 'needs_silent', 'reasoning'],
} as const

// Layer 0: deterministic inbound pre-filter.
// Only the two categories that are unambiguous AND catastrophic to auto-answer:
// legal/adversarial and PII. Everything fuzzier (problems, money, complaints) is
// left to the model, since that judgment is exactly what the model is for. This
// is a floor the model cannot lower, never a ceiling on what it can divert.
const LEGAL_ADVERSARIAL =
  /\b(?:lawyer|attorney|legal\s+action|lawsuit|sue|suing|litigat|dispute\s+the|chargeback|charge\s?back|\bftc\b|\bbbb\b|arbitration|breach\s+of\s+contract|cease\s+and\s+desist|scam|fraud(?:ulent)?)\b/i

/** Returns a forced sensitive category ('legal' | 'pii') or null. Pure. */
export function preFilterForced(message: string): Extract<SensitivityCategory, 'legal' | 'pii'> | null {
  if (inboundHasPII(message)) return 'pii'
  if (LEGAL_ADVERSARIAL.test(message)) return 'legal'
  return null
}

// A generated reply must never carry a link; catch the common URL shapes so a
// hallucinated link downgrades to a human draft instead of reaching a client.
const CONTAINS_LINK = /https?:\/\/|www\.|<https?:|\bslack:\/\/|\b[a-z0-9-]+\.(?:com|net|org|io|co|app)\b/i

/**
 * Reconcile the model decision with the deterministic pre-filter into an
 * executable plan. PURE (no IO), so the whole safety reconciliation is
 * unit-tested offline. Runs generated prose through the exact checkCompliance
 * gate the live senders use and downgrades anything that trips.
 */
export function planDispatch(
  decision: ReplyDecision,
  forced: ReturnType<typeof preFilterForced>
): DispatchPlan {
  const flags: string[] = []

  // Layer 0 wins outright: unambiguous legal/PII is a silent sensitive divert,
  // no matter what the model returned.
  if (forced) {
    return {
      action: 'divert_sensitive',
      sensitivityCategory: forced,
      needsSilent: true,
      flags: [`PREFILTER:${forced}`],
      // The pre-filter's own reason, not the model's. The model's reasoning
      // describes a decision that was overruled, and showing it on the review
      // card explained a pasted SSN as "not on the short list of things Max
      // may answer alone" instead of naming the actual cause.
      reasoning:
        forced === 'pii'
          ? 'personal data in the message, decided before the AI ran'
          : 'legal or adversarial wording, decided before the AI ran',
    }
  }

  if (decision.action === 'reply') {
    // Transactional: hand off to the deterministic template (it owns the link).
    if (decision.linkIntent) {
      return { action: 'reply', linkIntent: decision.linkIntent, flags, reasoning: decision.reasoning }
    }
    // Non-transactional prose: must exist, carry no link, and pass compliance.
    const raw = (decision.replyText || '').trim()
    if (!raw) {
      flags.push('MODEL_EMPTY_REPLY')
      return { action: 'divert_borderline', flags, reasoning: decision.reasoning }
    }
    if (CONTAINS_LINK.test(raw)) {
      flags.push('GENERATED_LINK')
      return { action: 'divert_borderline', replyText: raw, flags, reasoning: decision.reasoning }
    }
    const cleaned = sanitizeDashes(raw)
    const check = checkCompliance(cleaned)
    if (!check.passed) {
      // Never auto-send un-vetted generated text: downgrade to a human draft,
      // carrying the flags and the cleaned draft so a human can fix it.
      flags.push('AUTO_BLOCKED', ...check.flags)
      return { action: 'divert_borderline', replyText: cleaned, flags, reasoning: decision.reasoning }
    }
    return { action: 'reply', replyText: cleaned, flags, reasoning: decision.reasoning }
  }

  if (decision.action === 'divert_sensitive') {
    return {
      action: 'divert_sensitive',
      sensitivityCategory: decision.sensitivityCategory ?? 'problem',
      // pii/legal are always silent even if the model forgot to set it.
      needsSilent:
        decision.needsSilent ||
        decision.sensitivityCategory === 'pii' ||
        decision.sensitivityCategory === 'legal',
      flags,
      reasoning: decision.reasoning,
    }
  }

  if (decision.action === 'divert_borderline') {
    const draft = (decision.replyText || '').trim()
    return {
      action: 'divert_borderline',
      replyText: draft ? sanitizeDashes(draft) : undefined,
      flags,
      reasoning: decision.reasoning,
    }
  }

  // stay_out
  return { action: 'stay_out', flags, reasoning: decision.reasoning }
}
