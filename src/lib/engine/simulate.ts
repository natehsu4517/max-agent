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
 * TWO STANDING CONSTRAINTS ON THIS FILE
 *
 * 1. The simulation must never be more brittle than the thing it stands in for.
 *    A real model does not care whether someone typed a question mark or
 *    capitalised a sentence, so no rule here may depend on punctuation to
 *    recognise a question. A demo that answers "are we still on for 2?" but
 *    shrugs at "are we still on for 2" is showing a bug, not a policy.
 *
 * 2. A KEYWORD IS NOT A MEANING. Every rule below is a word match, and a word
 *    match reads "nothing is broken" and "the upload is broken" as the same
 *    event. Before any rule fires, it passes the stand-down gate: the trigger
 *    must not be negated, retracted, hypothetical, already resolved, or about
 *    somebody else's meeting. Getting this wrong is not cosmetic. On the
 *    transactional rules it takes a wrong ACTION ("please do NOT cancel our
 *    call on Thursday" once auto-sent a cancellation confirmation), and on the
 *    sensitive rules it says a wrong THING ("no need for a refund, we are
 *    happy" got "I hear you, your account lead is looking at this now").
 */

import type { LinkIntent, ReplyDecision, SensitivityCategory } from './types'

// ---------------------------------------------------------------------------
// The stand-down gate
// ---------------------------------------------------------------------------

const NEG_WORD =
  "not|no|never|nothing|nobody|none|instead of|forget|disregard|ignore|scratch|never ?mind|don'?t|doesn'?t|didn'?t|can'?t|won'?t|isn'?t|aren'?t|hasn'?t|haven'?t|wasn'?t|weren'?t"

// A negative attached to one of these verbs negates the SPEAKER'S STANCE, not
// the thing they are talking about. "I do not understand what the invoice is
// charging me for" is a billing question, and "I am not asking for a guarantee
// but will this be done by Friday" is a delivery-date question. Both were
// silently suppressed by the first version of this guard.
const STANCE_VERB = 'sure|certain|positive|clear|know|understand|think|say|saying|said|asking|ask|mean'

const NEGATION = new RegExp(`\\b(?:${NEG_WORD})\\b(?!\\s+(?:${STANCE_VERB})\\b)`, 'i')

/**
 * A negation binds inside its own clause, not across the whole message.
 *
 * Word-distance windows do not work here. "We have not been able to upload, it
 * is broken" and "we did not have any problem with the handoff" put the
 * negative a similar distance from the trigger and mean opposite things; the
 * clause boundary is what separates them.
 */
const CLAUSE_BREAK = /[.!?;:\n]+|,\s*|\s(?:but|and|so|because|however|though|although)\s/gi

function clauseAround(text: string, at: number): { clause: string; start: number } {
  let start = 0
  let end = text.length
  const re = new RegExp(CLAUSE_BREAK.source, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const bEnd = m.index + m[0].length
    if (bEnd <= at) start = bEnd
    else if (m.index > at) {
      end = m.index
      break
    }
  }
  return { clause: text.slice(start, end), start }
}

/**
 * Is the trigger negated within its own clause?
 *
 * The matched span is blanked out first, because several triggers carry their
 * own negative: "nothing is going through", "it will not let me submit", "I
 * can't log in", "no one can access", "we are not happy". Those are reports,
 * not denials, and reading their own words back as a negation would suppress
 * exactly the messages this system exists to escalate.
 */
function negatedInClause(text: string, at: number, matched: string): boolean {
  const { clause, start } = clauseAround(text, at)
  const from = at - start
  const masked = clause.slice(0, from) + ' '.repeat(matched.length) + clause.slice(from + matched.length)
  return NEGATION.test(masked)
}

/**
 * The client has already told us to stand down, anywhere in the message.
 *
 * These sit outside the clause rule on purpose, because a retraction usually
 * trails the thing it retracts: "Thanks for the invoice, no questions from us",
 * "I already have the calendar link, no need to send it again". Only phrases
 * that cannot plausibly appear in a live report belong here. "No rush" does
 * not qualify, because "the upload is broken, no rush though" is a real
 * problem report.
 */
const DISCLAIMER =
  /\bno need\b|\bno questions\b|\bno action needed\b|\bnothing needed\b|\bnothing for you\b|\bnothing to do with\b|\bunrelated\b|\bignore (?:any|the|my|that)\b|\bnever ?mind\b|\bdisregard\b|\balready (?:fixed|paid|sorted|submitted|handled|got|have|done|filled)\b|\bis fixed now\b|\bcleared up\b|\ball (?:resolved|sorted)\b|\bsorted (?:it|the|that|itself)\b|\bresolved itself\b|\bworked fine\b|\bcame through fine\b|\bturned it around\b|\bthanks for (?:sorting|fixing|handling|jumping on)\b|\bour old\b|\bthe other agency\b|\bprevious (?:agency|vendor)\b|\bused to\b/i

/**
 * The client is asking about a situation that has not happened.
 *
 * "In case we need to cancel the call, what is the process" is a policy
 * question. Firing the cancel template at it books a real cancellation off the
 * back of a hypothetical, which is the worst kind of wrong action: the client
 * gets a confirmation for something they were only asking about.
 */
// "if" carries two jobs in English and only one of them is conditional. After a
// verb of uncertainty it is a complementizer: "I am not sure IF this is a bug,
// but the upload fails every time" is a live report, and reading that "if" as
// hypothetical suppressed the report entirely.
const HYPOTHETICAL =
  /(?<!\b(?:sure|know|knows|knew|check|checking|see|ask|asking|wonder|wondering|tell|told|confirm|verify)\s)\bif\b|\bin case\b|\bwhenever\b|\bhypothetically\b|\bfor next time\b|\bdown the road\b|\bgoing forward\b|\bfor the future\b|\bfor planning purposes\b|\bwhat happens (?:if|when)\b|\bhow much notice\b|\bwhat is the (?:process|cutoff|policy)\b|\bis it possible to\b/i

/**
 * Somebody else's meeting, somebody else's problem.
 *
 * "Our supplier wants to reschedule their delivery" and "I need to set up a
 * call with our bank" both contain a clean scheduling verb aimed at a third
 * party. Acting on them moves a call with US that nobody mentioned.
 */
const THIRD_PARTY_SUBJECT =
  /\b(?:my|our|their|his|her)\s+\w+(?:\s+\w+)?\s+(?:wants?|needs?|asked|is going|are going|would like)\s+(?:\w+\s+)?to\b/i
const WITH_OTHERS = /\b(?:call|meeting|sync)\s+with\s+(?:our|my|their|a|an|the)\s+(?!account lead\b)\w+/i
// Someone in the client's life who is not a stakeholder. Deliberately narrow:
// "our team is frustrated" is a real complaint and must still fire, while "my
// sister is disappointed she cannot make the launch party" must not.
const PERSONAL_RELATION =
  /\b(?:my|our|their|his|her)\s+(?:\w+\s+)?(?:sister|brother|kid|kids|son|daughter|wife|husband|mum|mom|dad|parents|neighbou?r|friend)\b\s+(?:is|was|are|were|has|had|cannot|can'?t)\b/i

/** Every reason a matched rule should keep its mouth shut. */
function standsDown(text: string, at: number, matched: string): boolean {
  return (
    negatedInClause(text, at, matched) ||
    DISCLAIMER.test(text) ||
    THIRD_PARTY_SUBJECT.test(text) ||
    WITH_OTHERS.test(text) ||
    PERSONAL_RELATION.test(text)
  )
}

// ---------------------------------------------------------------------------
// Always-divert categories. Order matters: the first match wins, and the
// higher-harm categories are checked first.
// ---------------------------------------------------------------------------

const SENSITIVE_RULES: Array<{
  category: SensitivityCategory
  pattern: RegExp
  reasoning: string
}> = [
  {
    category: 'commitment',
    // "guarantee" needs us to be the one guaranteeing. A bare \bguarantee\b
    // answered "I can guarantee I'll be on the call Tuesday" by refusing to
    // commit to a date nobody had asked for.
    pattern:
      /\b(?:can|could|will|would|do)\s+(?:you|we)\s+guarantee\b|\b(?:a|any|the|some)\s+guarantee\b|\bcan you promise\b|\bhow long until\b|\bwhen will (?:it|this|we|you)\b|\bwill (?:it|this|we|you)\b[^.?!]{0,40}\b(?:be )?(?:done|ready|finished|live|ship|launch|deliver)\b/i,
    reasoning: 'the client is asking for a commitment on timing or outcome that the assistant cannot make',
  },
  {
    category: 'complaint',
    // "done with this" and "looking at other" need their dissatisfaction sense.
    // "all done with this on my end" is a completion update, and "looking at
    // other venues for the offsite" is neutral logistics; both were answered
    // with the script written for a client threatening to leave.
    pattern:
      /\b(?:refund|cancel (?:my|the|our) (?:contract|account|retainer|subscription|engagement)|want my money back|this is (?:ridiculous|unacceptable|a joke)|waste of (?:time|money)|not happy|unhappy|disappointed|frustrated)\b|\b(?:i'?m|i am|we'?re|we are)\s+done with (?:this|it|you)\b|\blooking at other (?:vendors?|agencies|agency|options|providers?|firms?|partners?|shops?|teams?)\b/i,
    reasoning: 'the client is expressing dissatisfaction or threatening to leave',
  },
  {
    category: 'money',
    // "how much" is only about money when the next word is not a unit of
    // something else. "How much time should we set aside" and "how much notice
    // do you need" were both answered as pricing questions.
    pattern:
      /\bhow much\b(?!\s+(?:time|notice|longer|warning|detail|context|info|information))|\bwhat.{0,12}(?:cost|rate|price)|\b(?:the|my|our) invoice\b|\bbilling\b|\bthe retainer\b|\bscope creep\b|\bout of scope\b|\bextra charge\b|\bwhat does .{0,20}number mean\b|\bfees?\b|\$\s?\d/i,
    reasoning: 'the client is asking about pricing, billing or scope',
  },
  {
    category: 'problem',
    // Three senses had to be pinned down here. "down" needs a verb in front of
    // it, or "I'm down for Thursday" is an outage. "blocked" needs to be
    // something happening TO the client, or "I blocked out Thursday morning
    // for you" is an incident. "stuck" needs to not be about their calendar.
    // Note the (?:ing|s)? tails too: "not work" with a hard \b after it never
    // matched "not working", which is how most people write it.
    pattern:
      /\b(?:is|are|was|were|went|goes|going|still)\s+down\b|\bdowntime\b|\b(?:no ?one|nobody)\s+(?:can|is able to)\b|\b(?:is|are|am|got|getting|been|we'?re|i'?m)\s+blocked\b|\bblocker\b|\bstuck\b(?!\s+(?:in|on)\s+(?:back|meetings?|calls?|traffic))|\b(?:broken|not work(?:ing|s)?|isn'?t work(?:ing|s)?|won'?t (?:let|load|submit|open|save|go)|(?:can'?t|cannot) (?:submit|log ?in|access|upload|see|find)|error|erroring|throwing|failing|failed|fails|bug|crash|crashing|timing out|timed out|timeout|issue with|problem with|something (?:is )?(?:wrong|off|broken)|went wrong|nothing (?:is )?(?:going|coming) through|stopped working|no longer work(?:ing|s)?)\b|\b(?:404|500|502|503)\b/i,
    reasoning: 'the client reported a problem or blocker, which always goes to a person',
  },
  {
    // Checked last, so a concrete category (a problem, an invoice) wins when
    // the client wraps it in "should we".
    category: 'advice',
    pattern:
      /\bshould (?:i|we)\b|\bwhat would you do\b|\bwhat do you (?:think|recommend|suggest)\b|\bwhich (?:one|option|way|route)\b[^.?!]{0,20}\b(?:should|better|best)\b|\bany (?:advice|recommendation|thoughts)\b|\bwould you (?:recommend|suggest)\b/i,
    reasoning: 'the client is asking for a recommendation, which is a judgment call a person owns',
  },
]

// ---------------------------------------------------------------------------
// A clean transactional ask.
//
// Every pattern here requires the scheduling word's OBJECT to be adjacent, not
// merely somewhere in the next forty characters. That gap was doing real
// damage: "push the deck over to me before the meeting" sent a reschedule
// link, "my schedule is packed but I'll be on the call" sent a booking link,
// and "cancel my dentist appointment tomorrow" told the client a human would
// cancel their call with us.
// ---------------------------------------------------------------------------

const DAY = 'tomorrow|today|monday|tuesday|wednesday|thursday|friday|next week|this week'
const OURS = 'call|meeting|check-?in|session|sync'
const DET = 'a|an|the|my|our|your|this|that|some'
// The ONE word allowed between the determiner and the noun, and only if it
// says WHEN rather than WHICH. "Cancel our Thursday call" is our call; "push
// our board meeting to next week" is their board meeting, and moving it is
// none of our business.
const QUAL =
  'tomorrow|today|monday|tuesday|wednesday|thursday|friday|next|last|upcoming|scheduled|weekly|regular|intro|check|quick|kickoff|kick-off|1:1|one on one'

const TRANSACTIONAL: Array<{ intent: LinkIntent; pattern: RegExp }> = [
  {
    intent: 'reschedule',
    pattern: new RegExp(
      `\\b(?:reschedule|move|push|change|shift|bump)\\b\\s+(?:${DET})?\\s*(?:(?:${QUAL})\\s+)?(?:${OURS})\\b|\\breschedul(?:e|ing)\\b(?!\\s+(?:my|our|their|the)\\s+(?!${OURS})\\w+)`,
      'i'
    ),
  },
  {
    intent: 'cancel',
    pattern: new RegExp(
      `\\bcancel\\b\\s+(?:${DET})?\\s*(?:(?:${QUAL})\\s+)?(?:${OURS})\\b|\\bcancel\\b\\s+(?:on\\s+)?(?:${DAY})\\b|\\bcancel\\b\\s*$`,
      'i'
    ),
  },
  {
    intent: 'book',
    pattern: new RegExp(
      `\\b(?:book|schedule|set up|get on|grab)\\b\\s+(?:${DET})?\\s*(?:(?:${QUAL})\\s+)?(?:${OURS}|time|calendar|slot)\\b|\\b(?:hop|jump|get) on a (?:call|zoom)\\b|\\bcalendar link\\b|\\bwhen (?:can|could) (?:we|i) (?:talk|meet|chat)\\b`,
      'i'
    ),
  },
  {
    intent: 'request',
    // The client has to be ASKING for the form. "The project form is done,
    // sending it back today" was answered by sending them the blank form.
    pattern:
      /\b(?:send|share|link|where|need|get|have|is there|point me)\b[^.?!]{0,30}\b(?:request|intake|project|change)\s+(?:request\s+)?form\b|\b(?:request|intake|project|change)\s+(?:request\s+)?form\s+(?:link|please)\b|\bwhere do i submit\b|\bhow do i (?:submit|file|put in) (?:a )?(?:request|ticket)\b/i,
  },
]

// The client says they will handle the next step themselves. This is what makes
// a transactional message "mixed" and therefore unsafe to auto-answer, because
// sending an unrequested rebook link talks over them.
//
// Written against normalized text (see normalizePunctuation): a smart apostrophe
// from a phone or a Slack paste must not be able to slip a message past this.
const SELF_INTENT =
  "(?:i|we)(?:'ll| will| am going to| are going to|'m going to|'re going to| plan to| intend to| can| would like to)"
const SELF_ACTION =
  "circle back|follow up|rebook|re-?book|book|reschedule|move|send|reach out|get back|come back|let you know|find|pick|handle|take care of|sort|figure|do that|deal with|take it from here"
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
//
// People do not close a thread with one tidy word. They stack two or three
// ("sounds good, thanks", "perfect thanks", "ok cool"), so this matches a run
// of up to three ack tokens rather than a single exact string. Getting this
// wrong is not dangerous, but it does make the assistant look brittle: an
// escalation to a human because someone typed "thank you so much" instead of
// "thanks" is a bad look in a demo about judgment.
const ACK_TOKEN =
  "thanks(?: so much| a lot| a bunch| again)?|thank you(?: so much| very much)?|ty|tysm|thx|got it|sounds good|sounds great|sounds like a plan|perfect|great|awesome|amazing|excellent|will do|ok|okay|k|cool|nice|appreciate it|much appreciated|no worries|np|you too|makes sense|understood|copy that|roger that|\u{1F44D}|\u{1F64F}|\u{1F389}"
const GRATITUDE = new RegExp(`^(?:(?:${ACK_TOKEN})[\\s!.,?~-]*){1,3}$`, 'iu')

// The client is informing, not asking. A trailing '?' is NOT how you tell:
// "I just submitted the form, can you confirm you got it" is a question with no
// question mark, and treating it as a status update dropped it silently, which
// is the only outcome in this system where nobody hears about a client at all.
const ASK_CUE =
  /\?|\b(?:can|could|would|will|is|are|do|does|did|should|when|what|where|who|how|why)\s+(?:you|we|i|it|this|that|they|there)\b/i
const STATUS_UPDATE =
  /\b(?:just )?(?:paid|submitted|sent|uploaded|booked it|signed|finished|completed|done with)\b/i

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
    // "next" has to mean the next step, not next week. "What is your
    // availability next week" was answered with "nothing is needed from you".
    pattern: /\bwhat(?:'s| is| happens)\b[^.?!]{0,40}\bnext\b(?!\s+(?:week|month|monday|tuesday|wednesday|thursday|friday|year|time|quarter))/i,
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
    // "are you good for" alone means "are you available for", which is a NEW
    // ask. Confirming it as already scheduled is a false statement about the
    // calendar, and the client stops trying to book.
    pattern:
      /\bare we (?:still )?(?:on|good) for\b|\bare you still (?:on|good) for\b|\bis (?:our|the) (?:call|meeting) still\b|\bare we still (?:meeting|talking|good)\b|\bwe still on\b/i,
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
    const m = rule.pattern.exec(text)
    if (!m) continue
    // "nothing is broken on our end" is not an outage report, and answering it
    // with "thanks for flagging that, I have pulled your lead in" is a reply
    // the client can see is wrong. Keep looking rather than firing this rule.
    if (standsDown(text, m.index, m[0]) || HYPOTHETICAL.test(text)) continue
    return {
      ...base,
      action: 'divert_sensitive',
      sensitivityCategory: rule.category,
      needsSilent: false,
      reasoning: rule.reasoning,
    }
  }

  const hit = TRANSACTIONAL.map((t) => ({ t, m: t.pattern.exec(text) })).find((x) => x.m)
  if (hit && hit.m) {
    // "Do not cancel Thursday" contains the word cancel and means the
    // opposite. Never act on a negated, retracted or third-party request.
    if (standsDown(text, hit.m.index, hit.m[0])) {
      return {
        ...base,
        action: 'divert_borderline',
        reasoning: 'the client is not asking us to do that, so there is nothing here to act on',
      }
    }
    // A question ABOUT cancelling is not a cancellation.
    if (HYPOTHETICAL.test(text)) {
      return {
        ...base,
        action: 'divert_borderline',
        reasoning: 'the client is asking about a what-if, not asking us to do it now',
      }
    }
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
      linkIntent: hit.t.intent,
      reasoning: `clean ${hit.t.intent} request, the whole message is the ask`,
    }
  }

  if (GRATITUDE.test(text)) {
    return { ...base, action: 'stay_out', reasoning: 'bare acknowledgement, nothing is needed from anyone' }
  }

  for (const rule of PROCESS_RULES) {
    const m = rule.pattern.exec(text)
    if (!m) continue
    // A canned answer asserts a fact, so it needs a higher bar than a hand-off.
    // "Did the deck not come through? I do not see it anywhere" was answered
    // with "yes, that came through on our end", which is simply false. Here the
    // negation inside the matched span counts, unlike everywhere else.
    if (NEGATION.test(m[0]) || standsDown(text, m.index, m[0]) || HYPOTHETICAL.test(text)) continue
    return { ...base, action: 'reply', replyText: rule.reply, reasoning: rule.reasoning }
  }

  if (STATUS_UPDATE.test(text) && !ASK_CUE.test(text)) {
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
