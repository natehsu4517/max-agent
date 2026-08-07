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
 * The rule precedence below mirrors the prompt. Note what changed: an ask used
 * to earn a link only when it was the WHOLE message, which sounded careful and
 * measured 95.9% unnecessary escalation on 402 messages. Each intent is now
 * judged on its own, and an intent a person must own escalates without
 * cancelling one Max may safely handle.
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
const STANCE_VERB =
  'sure|certain|positive|clear|know|understand|think|say|saying|said|asking|ask|mean|recognis\\w*|recogniz\\w*|recall|remember|follow|see|get'

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
  /\bno need\b(?!\s+to\s+(?:find|rebook|reschedul\w*|book|set up|pick)\b)|\bno questions\b|\bno action needed\b|\bnothing needed\b|\bnothing for you\b|\bnothing to do with\b|\bunrelated\b|\bignore (?:any|the|my|that)\b|\bnever ?mind\b|\bdisregard\b|\balready (?:fixed|paid|sorted|submitted|handled|got|have|done|filled)\b|\bis fixed now\b|\bcleared up\b|\ball (?:resolved|sorted)\b|\bsorted (?:it|the|that|itself)\b|\bresolved itself\b|\bworked fine\b|\bcame through fine\b|\bturned it around\b|\bthanks for (?:sorting|fixing|handling|jumping on)\b|\bour old\b|\bthe other agency\b|\bprevious (?:agency|vendor)\b|\bused to\b/i

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
// And "if you can", "if that works", "whenever works for you" are politeness,
// not conditions. They attach to a REQUEST the client is making right now.
// Reading them as what-ifs suppressed "put 20 min on for tomorrow if you can"
// and "throw something on my calendar for whenever works for you", which are
// two of the plainest booking requests in the whole corpus.
const HYPOTHETICAL =
  /(?<!\b(?:sure|know|knows|knew|check|checking|see|ask|asking|wonder|wondering|tell|told|confirm|verify)\s)\bif\b(?!\s+(?:you can|you could|possible|that works|thats ok|that's ok|you have|there'?s|need be|not|its easier|it'?s easier))|\bin case\b|\bwhenever\b(?!\s+(?:works|is good|suits|you))|\bhypothetically\b|\bfor next time\b|\bdown the road\b|\bgoing forward\b|\bfor the future\b|\bfor planning purposes\b|\bwhat happens (?:if|when)\b|\bhow much notice\b|\bwhat is the (?:process|cutoff|policy)\b|\bis it possible to\b/i

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

/**
 * Every reason a matched rule should keep its mouth shut.
 *
 * PERSONAL_RELATION is scoped to the sensitive rules only. It exists to stop
 * "my sister is disappointed she cannot make the launch party" being read as a
 * client complaint, where the relation is the SUBJECT of the feeling. On the
 * action side the relation is usually the REASON for a perfectly real request:
 * "were gonna have to move the check in this week, my kid has a thing at
 * school" is our check-in, and standing down on it left the client waiting.
 *
 * The gate that stops rules over-firing can itself over-fire, and it is harder
 * to notice, because a guard that suppresses too much looks like caution.
 */
function standsDown(text: string, at: number, matched: string, scope: 'action' | 'sensitive'): boolean {
  return (
    negatedInClause(text, at, matched) ||
    DISCLAIMER.test(text) ||
    THIRD_PARTY_SUBJECT.test(text) ||
    WITH_OTHERS.test(text) ||
    (scope === 'sensitive' && PERSONAL_RELATION.test(text))
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
// Intent recognition.
//
// This used to be four regexes, each anchored on a verb: book|schedule|set up|
// get on|grab, move|push|change|shift|bump, cancel, and a form pattern. Tested
// against 21 phrasings written by the same person in the same sitting, it looked
// acceptable: 10 of 21. Tested against 402 messages written by somebody else, it
// handled 5 of 134. book 1/74. move 3/35. cancel 1/25.
//
// The gap is not carelessness, it is that people do not name the action. They
// describe the world and leave the action implied: "when are you free this
// week", "got 20 min thursday", "do you have half an hour tomorrow", "cant make
// tomorrow", "throw something on my calendar". Not one contains a scheduling
// verb. All five are unambiguous requests.
//
// So: several narrow cues per intent instead of one clever pattern. Each cue is
// defensible on its own and each passes the stand-down gate before it fires, so
// widening recognition here does not widen what gets acted on while negated,
// hypothetical, or about somebody else's calendar.
// ---------------------------------------------------------------------------

const DAY =
  "tomorrow|today|tonight|tmrw|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|weds?|thurs?|fri|next week|this week|later this week|early next week"
const OURS = 'call|meeting|check-?in|session|sync'
// What counts as one of our conversations, for recognition. Wider than OURS,
// which stays narrow because it also guards the tighter move patterns below.
const MEET =
  "calls?|meetings?|check-? ?ins?|checkins?|session|sync|chat|zoom|standup|stand-? ?up|catch-? ?up|huddle|1:1|one on one|convo|conversation|debrief"
const DUR = "\\d{1,3}\\s?(?:min(?:ute)?s?|hrs?|hours?)|half an hour|an hour|a half hour"
// Self-grouped on purpose. Written bare, `(?:${DET}\s+)?` expands to
// `(?:a|an|...|some\s+)?` and the \s+ binds to the last alternative only, so
// "cancel my call" silently stopped matching and every cancellation fell
// through to a human. An alternation handed to a template literal must carry
// its own group.
const DET = '(?:a|an|the|my|our|your|this|that|some)'
// The ONE word allowed between the determiner and the noun, and only if it
// says WHEN rather than WHICH. "Cancel our Thursday call" is our call; "push
// our board meeting to next week" is their board meeting, and moving it is
// none of our business.
const QUAL =
  "(?:tomorrow|today|monday|tuesday|wednesday|thursday|friday|next|last|upcoming|scheduled|weekly|regular|intro|check|quick|kickoff|kick-off|1:1|one on one)(?:'?s)?"

// A cancellation that also asks for a replacement slot is a reschedule. Same
// inability, different ask, and the difference decides whether the client gets
// a rebooking link or a confirmation.
const REBOOK_CUE =
  /\b(?:another|a different|some other|a new)\s+(?:day|time|slot|date)\b|\bresched\w*\b|\bmove it\b|\bwhat about\b|\binstead\b|\bis there\b[^.?!]{0,24}\b(?:that|this|next) week\b|\bpush (?:it|this) (?:to|out|back)\b/i
const NO_REBOOK =
  /\bno need to (?:find|rebook|reschedul\w*|set up|book)\b|\bwe can (?:pick|catch) (?:it|this|that) up\b|\bnext (?:week|time) is fine\b|\bdon'?t need to (?:rebook|reschedul\w*)\b/i

/**
 * Words that make a message worth someone's attention even when it is phrased
 * as a plain FYI with no question in it.
 *
 * This exists to keep messages out of stay_out, which is the only outcome in
 * the whole system where nobody hears about a client at all. It is deliberately
 * over-broad: a false hit here costs one person one glance, and a miss costs a
 * client a silently discarded defect report.
 */
const SUBSTANTIVE =
  /\b(?:not|isn'?t|aren'?t|wasn'?t|weren'?t|won'?t|doesn'?t|didn'?t|can'?t|cannot|never|wrong|broken|error|errors|fail|fails|failing|failed|missing|duplicate|twice|stuck|weird|odd|strange|off|refund|refunds|refunded|charge|charged|chargeback|payment|payments|invoice|billing|scope|approved|approve|sign(?:ed)? off|dispute|disputed|escalat\w*|urgent|asap|blocked|blocker)\b/i

/**
 * Wording that forfeits autonomy even when nothing forced a silent divert.
 *
 * Widening recognition raised the price of a detection miss. Before, a legal
 * message the pre-filter did not catch simply got an over-cautious hand-off,
 * which cost nothing. Now the safe half of a mixed message gets acted on, so
 * the same miss fires a booking link at somebody whose counsel is asking how
 * the checkout stores card data. That happened: "no rush at all but legal
 * flagged something about how the checkout stores card data. can we get time
 * this week" auto-sent a calendar link, because LEGAL_ADVERSARIAL wants
 * "legal action" and this said "legal flagged".
 *
 * So the action side gets its own floor, independent of the forced filter.
 * Escalation is unaffected: a person still sees every one of these. The rule
 * is only that Max does not DO anything while they are in the message.
 *
 * Any time recognition is widened, something like this has to widen with it.
 */
const NO_AUTONOMY =
  /\blegal\b|\bcounsel\b|\bgeneral counsel\b|\bindemnit\w*|\bliabilit\w*|\bmsa\b|\bsow\b|\bamendment\b|\bterminat\w*|\bcontract\b|\bnotary\b|\binsurance\b|\bmember id\b|\blicen[sc]e number\b|\bsocial security\b|\bdob\b|\bnda\b/i

const INTENT_CUES: Array<{ intent: LinkIntent; why: string; cues: RegExp[] }> = [
  {
    intent: 'cancel',
    why: 'the client is calling off a scheduled conversation',
    cues: [
      // "cancel" needs an object that is OURS, or no object at all. A bare
      // \bcancel\b read "had to cancel my dentist appointment tomorrow so my
      // morning is wide open" as a request to cancel a call with us, which is
      // the exact class of bug the narrow patterns existed to prevent. Widening
      // recognition is not licence to drop the object constraint.
      new RegExp(
        `\\bcancel(?:l?ing|l?ed|s)?\\b\\s+(?:${DET}\\s+)?(?:(?:${QUAL})\\s+)?(?:${MEET})\\b`,
        'i'
      ),
      new RegExp(`\\bcancel(?:l?ing|l?ed|s)?\\b\\s+(?:on\\s+)?(?:${DAY})\\b`, 'i'),
      /\bcancel(?:l?ing|l?ed|s)?\b\s+(?:it|this|that|us)\b/i,
      /\bcancel(?:l?ing|l?ed|s)?\b\s*(?:[.!?]|$)/i,
      new RegExp(
        `\\b(?:skip|drop|kill|scrap|call off|bail on|pass on)\\b\\s+(?:${DET}\\s+)?(?:(?:${QUAL})\\s+)?(?:${MEET}|${DAY})\\b`,
        'i'
      ),
      new RegExp(
        `\\b(?:can'?t|cannot|can not|unable to|won'?t be able to|not able to|not gonna|not going to)\\b[^.?!]{0,16}\\b(?:make|do|attend|join|be (?:on|there|at)|swing)\\b`,
        'i'
      ),
      /\bhave to (?:bail|drop|miss|cancel|skip|postpone)\b/i,
      /\b(?:something came up|out sick|i'?m sick|im sick|under the weather)\b/i,
    ],
  },
  {
    intent: 'reschedule',
    why: 'the client is asking to move a conversation that is already on the calendar',
    cues: [
      new RegExp(
        `\\b(?:move|push|shift|bump|slide|swap|switch|change)\\b\\s+(?:${DET}\\s+)?(?:(?:${QUAL})\\s+)?(?:${MEET})\\b`,
        'i'
      ),
      // Same object constraint as cancel: "I need to reschedule my dentist
      // appointment before our call" is not a request to move anything of ours.
      new RegExp(`\\bresched\\w*\\b(?!\\s+(?:my|our|their|the|a|an)\\s+(?!${MEET})\\w+)`, 'i'),
      new RegExp(`\\b(?:move|push|bump|shift)\\s+(?:it|this|that|us)\\b[^.?!]{0,18}\\b(?:${DAY}|back|out|later|earlier|forward)\\b`, 'i'),
      /\b(?:another|a different|some other|a new)\s+(?:day|time|slot|date)\b/i,
      /\b(?:later|earlier)\s+(?:in the day|that day|today|tomorrow|on)\b/i,
      /\bcan it be\b[^.?!]{0,22}\b(?:later|earlier|instead|\d)/i,
      /\b(?:do|make it)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b[^.?!]{0,18}\binstead\b/i,
      new RegExp(`\\bmove\\s+(?:${DET}\\s+)?(?:${DAY})\\b`, 'i'),
    ],
  },
  {
    intent: 'book',
    why: 'the client is asking for time on the calendar',
    cues: [
      // an explicit scheduling verb with its object close behind
      new RegExp(
        `\\b(?:book|schedule|set ?up|arrange|line up|pencil|slot|lock in|throw|put|find|grab|get)\\b(?:\\s+\\w+){0,3}\\s+(?:${MEET}|time|calendar|slot)\\b`,
        'i'
      ),
      // availability, asked as a question about the other side
      /\b(?:when|what times?|what days?)\b[^.?!]{0,20}\b(?:are|is|r)\b[^.?!]{0,14}\b(?:free|available|around|open|good)\b/i,
      /\bwhen(?:'?s| is| are)\b[^.?!]{0,16}\b(?:you|u|avery|your team|yall|y'all)\b/i,
      /\b(?:your|the)\s+(?:calendar|schedule|availability)\b[^.?!]{0,20}\b(?:look|like|open|free)\b/i,
      /\bany\s+(?:availability|openings?|free time|slots?|time)\b/i,
      // a duration, offered or asked for
      new RegExp(`\\b(?:got|have|you got|do you have|free for|spare)\\b(?:\\s+\\w+){0,2}\\s+(?:${DUR})`, 'i'),
      new RegExp(`\\b(?:${DUR})\\b[^.?!]{0,18}\\b(?:${DAY})\\b`, 'i'),
      // proposing a conversation
      /\b(?:can|could|shall|should|any chance)\b[^.?!]{0,22}\b(?:we|i|you)\b[^.?!]{0,18}\b(?:talk|meet|chat|connect|sync|speak|catch up|hop on|jump on|get on)\b/i,
      /\b(?:let'?s|lets|wanna|want to|would like to|i'?d like to|id like to)\b[^.?!]{0,22}\b(?:talk|meet|chat|connect|sync|catch up|find time|grab time|get time)\b/i,
      new RegExp(`\\b(?:free|available|around|open)\\b[^.?!]{0,20}\\b(?:${DAY})\\b`, 'i'),
      /\b(?:hop|jump|get) on a\b/i,
      /\bon (?:my|your|the|his|her) calendar\b/i,
      /\bcalendar link\b/i,
      /\bon the books\b/i,
    ],
  },
  {
    intent: 'request',
    // The client has to be ASKING for the form. "The project form is done,
    // sending it back today" was answered by sending them the blank form.
    why: 'the client is asking where to submit something they already have access to',
    cues: [
      /\b(?:send|share|link|where|need|get|have|is there|point me)\b[^.?!]{0,30}\b(?:request|intake|project|change)\s+(?:request\s+)?form\b/i,
      /\b(?:request|intake|project|change)\s+(?:request\s+)?form\s+(?:link|please)\b/i,
      /\bwhere do i submit\b/i,
      /\bhow do i (?:submit|file|put in|raise|open) (?:a )?(?:request|ticket|change)\b/i,
    ],
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
    // The subject has to be a THING that arrives. "did we ever land on the
    // abandoned cart email" is asking whether a decision was ever made, and it
    // was answered "yes, that came through on our end", which is both false and
    // exactly the kind of confident nonsense this system exists to prevent.
    pattern:
      /\b(?:did you (?:get|receive)|have you (?:got|received))\b|\bdid\s+(?:it|that|this|the|my|our)\b[^.?!]{0,20}\b(?:come through|go through|land)\b(?!\s+on\b)/i,
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

// The client says they will handle the rebooking themselves. That does not make
// the message unsafe, it makes the LINK unwanted: cancel it, tell a person, and
// do not talk over them with a calendar link they just said they did not need.
const SELF_HANDLED_ACK =
  'Got it, that is cancelled. Send those times over whenever you have them and we will get it back on the calendar.'

/**
 * The first sensitive category present, or null.
 *
 * Split out of the decision so that BOTH halves of a message can be read before
 * either one decides anything.
 */
function findSensitive(text: string) {
  for (const rule of SENSITIVE_RULES) {
    const m = rule.pattern.exec(text)
    if (!m) continue
    // "nothing is broken on our end" is not an outage report.
    if (standsDown(text, m.index, m[0], 'sensitive') || HYPOTHETICAL.test(text)) continue
    return rule
  }
  return null
}

/**
 * What the client is asking us to DO, or null.
 *
 * Every cue passes the stand-down gate individually, so "do NOT cancel thursday"
 * and "if we ever need to move this" still resolve to nothing.
 */
function findIntent(text: string): { intent: LinkIntent; why: string } | null {
  for (const group of INTENT_CUES) {
    for (const cue of group.cues) {
      const m = cue.exec(text)
      if (!m) continue
      if (standsDown(text, m.index, m[0], 'action') || HYPOTHETICAL.test(text)) continue
      // "cant do thursday anymore, is there another day that week" is a move,
      // not a cancellation. The inability is identical; the ask is not.
      const intent =
        group.intent === 'cancel' && REBOOK_CUE.test(text) && !NO_REBOOK.test(text)
          ? 'reschedule'
          : group.intent
      return { intent, why: group.why }
    }
  }
  return null
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
    notify: null,
    degraded: null,
  }

  if (!text) {
    return { ...base, action: 'stay_out', reasoning: 'empty message' }
  }

  // BOTH halves are read before either decides. The old order returned on the
  // first sensitive hit, so "can we get time on the calendar? the staging build
  // is erroring out" lost the booking entirely: an unsafe TOPIC suppressed a
  // safe ACTION that merely shared a paragraph with it.
  const sensitive = findSensitive(text)
  // The floor: recognise the ask, then refuse to act on it.
  const ask = NO_AUTONOMY.test(text) ? null : findIntent(text)

  // Lane B. The message carries work Max may do AND something a person has to
  // see, so it gets both instead of being filed under one of them.
  if (ask && sensitive) {
    if (SELF_HANDLING.test(text)) {
      return {
        ...base,
        action: 'reply',
        replyText: SELF_HANDLED_ACK,
        notify: sensitive.reasoning,
        reasoning: 'the client handles the next step, so no link, and a person is pinged for the rest',
      }
    }
    return {
      ...base,
      action: 'reply',
      linkIntent: ask.intent,
      // Carried so the review card can tell the truth about what is left. The
      // safe half is done; the other half is still somebody's problem, and a
      // card that says "no action needed" over an unhandled outage is the kind
      // of small lie that costs the whole system its credibility.
      sensitivityCategory: sensitive.category,
      notify: sensitive.reasoning,
      reasoning: `${ask.why}, and there is something else here a person has to see`,
    }
  }

  if (sensitive) {
    return {
      ...base,
      action: 'divert_sensitive',
      sensitivityCategory: sensitive.category,
      needsSilent: false,
      reasoning: sensitive.reasoning,
    }
  }

  if (ask) {
    // A cancellation is safe to action and is also the loudest health signal a
    // client ever sends. Do it, and say so internally. Notifying is not the
    // same as needing approval, and conflating the two is what made this
    // assistant hand back every cancellation it was perfectly able to handle.
    const notify =
      ask.intent === 'cancel'
        ? 'the client cancelled, which is worth knowing even though it is already handled'
        : null
    if (SELF_HANDLING.test(text)) {
      return {
        ...base,
        action: 'reply',
        replyText: SELF_HANDLED_ACK,
        notify: notify ?? 'the client is handling the next step themselves',
        reasoning: 'the client is rebooking themselves, so it is acknowledged without a link',
      }
    }
    return { ...base, action: 'reply', linkIntent: ask.intent, notify, reasoning: ask.why }
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
    if (NEGATION.test(m[0]) || standsDown(text, m.index, m[0], 'sensitive') || HYPOTHETICAL.test(text)) continue
    return { ...base, action: 'reply', replyText: rule.reply, reasoning: rule.reasoning }
  }

  // Standing out is the only outcome where NOBODY hears about a client, so it
  // has to be a positive finding rather than a fallthrough.
  //
  // It was a fallthrough. "refunds issued in the admin aren't showing as
  // refunded on the customer's order page" matched STATUS_UPDATE, carried no
  // question mark, and was discarded: no reply, no card, nobody told. Two live
  // payment defects and a scope dispute went that way in one 402-message run.
  // An update now has to be inert in its own words to qualify.
  if (STATUS_UPDATE.test(text) && !ASK_CUE.test(text) && !SUBSTANTIVE.test(text)) {
    return { ...base, action: 'stay_out', reasoning: 'client is informing us and nothing in it needs anyone' }
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
  // Reads the same cues, with none of the gates: no stand-down, no clause
  // scoping, no second intent. One label for the whole message, which is
  // exactly the failure being illustrated.
  const hit = INTENT_CUES.find((g) => g.cues.some((c) => c.test(text)))
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
