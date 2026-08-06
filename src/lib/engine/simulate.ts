/**
 * Layer 1, simulated.
 *
 * In production this is a Sonnet call with SAFE_ZONE_SYSTEM and a forced JSON
 * schema. Here it is a deterministic function that applies the same rules the
 * prompt states, so the demo runs offline, for free, forever, and gives the
 * same answer every time you click.
 *
 * This is the ONE layer of the pipeline that is not the production code. Layers
 * 0 and 2 around it, and the compliance filter they call, are ported verbatim.
 * The demo labels this boundary rather than hiding it: a simulated model that
 * is honest about being simulated is more useful than a live one you cannot
 * afford to leave running on a public URL.
 *
 * The rule precedence below mirrors the prompt: the always-divert categories
 * outrank the safe zone, and a transactional ask only earns a link when that ask
 * is the WHOLE message.
 *
 * A standing constraint on this file: the simulation must never be more brittle
 * than the thing it stands in for. A real model does not care whether someone
 * typed a question mark or capitalised a sentence, so no rule here may depend on
 * punctuation to recognise a question. People drop question marks in Slack
 * constantly, and a demo that answers "are we still on for 2?" but shrugs at
 * "are we still on for 2" is showing a bug, not a policy.
 */

import type { LinkIntent, ReplyDecision, SensitivityCategory } from './types'

// Always-divert categories. Order matters: the first match wins, and the
// higher-harm categories are checked first.
const SENSITIVE_RULES: Array<{
  category: SensitivityCategory
  pattern: RegExp
  reasoning: string
}> = [
  {
    category: 'commitment',
    pattern:
      /\bguarantee|\bcan you promise\b|\bhow long until\b|\bwhen will (?:it|this|we|you)\b|\bwill (?:it|this|we|you)\b[^.?!]{0,40}\b(?:be )?(?:done|ready|finished|live|ship|launch|deliver)\b|\bshould (?:i|we)\b/i,
    reasoning: 'the client is asking for a commitment on timing or outcome that the assistant cannot make',
  },
  {
    category: 'complaint',
    pattern:
      /\b(?:refund|cancel (?:my|the|our) (?:contract|account|retainer|subscription|engagement)|want my money back|this is (?:ridiculous|unacceptable|a joke)|waste of (?:time|money)|not happy|unhappy|disappointed|frustrated|done with this|looking at other)\b/i,
    reasoning: 'the client is expressing dissatisfaction or threatening to leave',
  },
  {
    category: 'money',
    pattern:
      /\b(?:how much|what.{0,12}(?:cost|rate|price)|the invoice|my invoice|our invoice|billing|the retainer|scope creep|out of scope|extra charge|what does .{0,20}number mean|fees?)\b|\$\s?\d/i,
    reasoning: 'the client is asking about pricing, billing or scope',
  },
  {
    category: 'problem',
    pattern:
      /\b(?:down|broken|not work|isn'?t work|won'?t (?:let|load|submit|open|save|go)|can'?t (?:submit|log ?in|access|upload|see|find)|error|erroring|throwing|failing|failed|fails|bug|crash|crashing|timing out|timed out|timeout|stuck|blocked|issue with|problem with|something (?:is )?(?:wrong|off|broken)|went wrong|nothing (?:is )?(?:going|coming) through|stopped working|no longer work)\b|\b(?:404|500|502|503)\b/i,
    reasoning: 'the client reported a problem or blocker, which always goes to a person',
  },
]

// A clean transactional ask. The verb has to be about a call or the form.
const TRANSACTIONAL: Array<{ intent: LinkIntent; pattern: RegExp }> = [
  { intent: 'reschedule', pattern: /\b(?:reschedule|move|push|change)\b[^.?!]{0,40}\b(?:call|meeting|appointment|time)\b|\breschedule\b/i },
  { intent: 'cancel', pattern: /\bcancel\b[^.?!]{0,40}\b(?:call|meeting|appointment|tomorrow|today)\b|\bcancel (?:my|the|our) (?:call|meeting|appointment)\b/i },
  { intent: 'book', pattern: /\b(?:book|schedule|set up|get on)\b[^.?!]{0,40}\b(?:call|meeting|time|calendar)\b|\bcalendar link\b|\bwhen (?:can|could) (?:we|i) (?:talk|meet|chat)\b/i },
  { intent: 'request', pattern: /\b(?:request|intake|project|change)\s+(?:request\s+)?form\b|\bhow do i (?:submit|file|put in) (?:a )?(?:request|ticket)\b|\brequest form link\b/i },
]

// The client says they will handle the next step themselves. This is what makes
// a transactional message "mixed" and therefore unsafe to auto-answer, because
// sending an unrequested rebook link talks over them.
//
// Written against normalized text (see normalizePunctuation): a smart apostrophe
// from a phone or a Slack paste must not be able to slip a message past this.
const SELF_INTENT = "i(?:'ll| will| am going to|'m going to| plan to| intend to| can| would like to)"
const SELF_ACTION =
  "circle back|follow up|rebook|re-?book|reschedule|send|reach out|get back|let you know|find|pick|handle|take care of|sort|figure|do that|deal with"
const SELF_HANDLING = new RegExp(`\\b${SELF_INTENT}\\b[^.?!]{0,60}\\b(?:${SELF_ACTION})\\b`, 'i')

/**
 * Fold smart punctuation to ASCII before any rule reads the text.
 *
 * Every apostrophe rule below is written with a straight quote, and macOS,
 * iOS, Slack, Word and Notes all substitute U+2019 silently. Without this the
 * mixed-cancel case, the one this whole system exists to get right, passes
 * SELF_HANDLING and auto-sends a rebook link.
 */
export function normalizePunctuation(text: string): string {
  return text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
}

// Bare acknowledgements that need nothing from anyone.
const GRATITUDE = /^(?:thanks|thank you|ty|thx|got it|sounds good|perfect|great|awesome|will do|ok|okay|👍|🙏)[\s!.,]*$/i

// The client is informing, not asking.
const STATUS_UPDATE =
  /\b(?:just )?(?:paid|submitted|sent|uploaded|booked it|signed|finished|completed|done with)\b(?![^.?!]*\?)/i

// Simple process questions the assistant may answer in one or two sentences.
// Each answer is written for its own question: a generic "someone will follow
// up" pasted onto everything is what makes an assistant feel like a machine.
const PROCESS_RULES: Array<{ pattern: RegExp; reply: string; reasoning: string }> = [
  {
    pattern: /\b(?:did you (?:get|receive)|have you (?:got|received)|did .{0,25}(?:come through|go through|land))\b/i,
    reply: 'Yes, that came through on our end. Your account lead will take a look and follow up.',
    reasoning: 'a receipt confirmation, with nothing substantive riding on it',
  },
  {
    pattern:
      /\b(?:office hours|working hours|what (?:are )?your hours|what time.{0,20}(?:open|available)|when are you (?:open|around|available))\b/i,
    reply: 'The team is around weekdays, 9 to 6 Eastern. Anything sent after that gets picked up the next morning.',
    reasoning: 'an office-hours question, purely logistical',
  },
  {
    pattern: /\bwhat(?:'s| is| happens)\b[^.?!]{0,40}\bnext\b/i,
    reply: 'Your account lead will walk you through the next step on the upcoming call. Nothing is needed from you before then.',
    reasoning: 'a general process question with no numbers or dates attached',
  },
  {
    pattern: /\b(?:who(?:'s| is)|which of you)\b[^?]{0,30}\b(?:working on|handling|leading|on this|my (?:account|project))\b/i,
    reply: 'Avery is your account lead and is closest to this one day to day.',
    reasoning: 'asking who owns the account, which is a plain fact about the team',
  },
  {
    pattern: /\b(?:where do i|how do i|can i)\b[^?]{0,40}\b(?:find|see|access|get to)\b[^?]{0,30}\b(?:file|doc|deck|notes|link|folder|recording)/i,
    reply: 'Everything for this project lives in the shared folder linked at the top of this channel.',
    reasoning: 'pointing at a location the client already has access to',
  },
  {
    pattern:
      /\bare (?:we|you) (?:still )?(?:on|good) for\b|\bis (?:our|the) (?:call|meeting) still\b|\bare we still (?:meeting|talking|good)\b|\bwe still on\b/i,
    reply: 'Yes, that is still on the calendar as scheduled.',
    reasoning: 'confirming a booking that already exists, no new commitment made',
  },
]

// An additive clause means there is a second thing in the message.
const ADDITIVE = /\b(?:also|plus|one more thing|another thing|by the way|btw|as well as that|on top of that)\b/i

// A bare greeting is not a second thought, so it must not make a message "mixed".
const GREETING = /^(?:hi|hey|hello|good morning|good afternoon|morning|afternoon|yo|hiya)[\s,!-]*$/i

/**
 * Is the transactional ask the entire message? Anything else in there means the
 * assistant should hand it to a person rather than fire a link at it.
 */
function askIsWholeMessage(text: string): boolean {
  if (ADDITIVE.test(text)) return false
  const sentences = text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !GREETING.test(s))
  return sentences.length <= 1
}

/**
 * Stand-in for the Sonnet call. Same contract, same output shape, no network.
 */
export function simulateModel(redactedMessage: string): ReplyDecision {
  const text = normalizePunctuation(redactedMessage.trim())

  const base: Omit<ReplyDecision, 'action' | 'reasoning'> = {
    linkIntent: null,
    replyText: null,
    sensitivityCategory: null,
    needsSilent: false,
    degraded: null,
  }

  if (!text) {
    return { ...base, action: 'stay_out', reasoning: 'empty message' }
  }

  // Always-divert categories outrank everything in the safe zone, including a
  // transactional ask sitting in the same sentence.
  for (const rule of SENSITIVE_RULES) {
    if (rule.pattern.test(text)) {
      return {
        ...base,
        action: 'divert_sensitive',
        sensitivityCategory: rule.category,
        needsSilent: false,
        reasoning: rule.reasoning,
      }
    }
  }

  const hit = TRANSACTIONAL.find((t) => t.pattern.test(text))
  if (hit) {
    // MIXED MESSAGES ARE THE TRAP. A transactional word plus the client saying
    // they will handle the next step is not a clean safe-zone reply.
    if (SELF_HANDLING.test(text)) {
      return {
        ...base,
        action: 'divert_borderline',
        replyText: 'Got it, I have let Avery know. Send those times over whenever you have them.',
        reasoning: 'a mixed message: a transactional ask plus the client handling the next step themselves',
      }
    }
    // A request is clean ONLY when that ask IS the whole message. Counting
    // question marks was not enough: "Cancel tomorrow. I'll rebook later"
    // carries a second ask and no second '?'.
    if (!askIsWholeMessage(text)) {
      return {
        ...base,
        action: 'divert_borderline',
        reasoning: 'the message carries more than the ask, so it is not a clean single-intent request',
      }
    }
    return {
      ...base,
      action: 'reply',
      linkIntent: hit.intent,
      reasoning: `clean ${hit.intent} request, the whole message is the ask`,
    }
  }

  if (GRATITUDE.test(text)) {
    return { ...base, action: 'stay_out', reasoning: 'bare acknowledgement, nothing is needed from anyone' }
  }

  for (const rule of PROCESS_RULES) {
    if (rule.pattern.test(text)) {
      return { ...base, action: 'reply', replyText: rule.reply, reasoning: rule.reasoning }
    }
  }

  if (STATUS_UPDATE.test(text)) {
    return { ...base, action: 'stay_out', reasoning: 'client is informing us, no reply or human action needed' }
  }

  // When in doubt between reply and divert_borderline, choose divert_borderline.
  // This is the default for anything unrecognised, and it is the point: the
  // list of things Max may answer alone is short and closed on purpose, so
  // "I do not recognise this" and "a person should take it" are the same
  // answer rather than an error.
  return {
    ...base,
    action: 'divert_borderline',
    reasoning:
      'this is not on the short list of things Max may answer alone, so it goes to a person by default',
  }
}

/**
 * The classifier this system replaced: one Haiku call returning a single word.
 *
 * Kept because it is the demo's most useful comparison. It cannot represent a
 * mixed message, so "cancel my call, but I'll circle back with times" came back
 * as the single token `cancel` and auto-fired a cancel-plus-rebook-link
 * template at a client who had just said they would handle it. That production
 * bug is why the reply brain exists.
 */
export function legacyClassify(message: string): LinkIntent | 'gratitude' | 'update' | 'other' {
  const text = message.trim()
  const hit = TRANSACTIONAL.find((t) => t.pattern.test(text))
  if (hit) return hit.intent
  if (GRATITUDE.test(text)) return 'gratitude'
  if (STATUS_UPDATE.test(text)) return 'update'
  return 'other'
}

/** What the legacy classifier would have DONE with that single word. */
export function legacyWouldAutoSend(message: string): boolean {
  const label = legacyClassify(message)
  return label === 'book' || label === 'reschedule' || label === 'cancel' || label === 'request'
}
