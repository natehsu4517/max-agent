/**
 * The pipeline, in the order production runs it, emitting a trace step for
 * every layer so the UI can show its work.
 *
 * The ordering is the design. Redaction happens before anything downstream can
 * see the text. The human-first backstop happens before the model, so an
 * engaged human costs zero tokens and the assistant never talks over them. The
 * compliance gate happens after the model, on the model's own words.
 *
 * Every trace step carries a plain-English reading and the function name an
 * engineer would grep for, because both audiences look at this page.
 */

import { checkCompliance, inboundHasPII, redactPII, sanitizeDashes } from './compliance'
import { planDispatch, preFilterForced } from './brain'
import { simulateModel } from './simulate'
import { renderTransactional, handoffAck, afterHoursAck } from './templates'
import type { DraftStatus, PipelineResult, ReplyDecision, TraceStep } from './types'

export interface PipelineOptions {
  /** A human posted in the channel during the 10-minute hold. */
  humanRepliedDuringHold?: boolean
  clientFirstName: string
  advisorName: string
  advisorMention: string
  /** Next open calendar slots, from deterministic calendar data. */
  slots?: string[]
  /**
   * Force the model layer to return a specific decision, standing in for a bad
   * day at the model. Used to demonstrate that Layer 2 catches what Layer 1
   * gets wrong, which is the only reason Layer 2 exists.
   */
  modelOverride?: ReplyDecision
  /** The message arrived outside business hours. */
  afterHours?: boolean
  /** The model call itself failed (timeout, bad JSON, outage). */
  modelFailed?: boolean
}

/**
 * How long an inbound message is held before the assistant may act.
 *
 * In production a cron drains held rows once this has elapsed. The demo
 * resolves the hold instantly and reports what the drain would have found.
 */
export const REPLY_HOLD_MS = 10 * 60 * 1000
const HOLD_MINUTES = REPLY_HOLD_MS / 60_000

export function runPipeline(rawMessage: string, opts: PipelineOptions): PipelineResult {
  const trace: TraceStep[] = []
  const hasPII = inboundHasPII(rawMessage)
  const redactedMessage = hasPII ? redactPII(rawMessage) : rawMessage

  trace.push({
    layer: 0,
    title: 'Look for personal information',
    technical: 'redactPII',
    kind: 'deterministic',
    verdict: hasPII ? 'Found some, and removed it' : 'Nothing sensitive in here',
    detail: hasPII
      ? 'Numbers shaped like a social security, tax, card or account number were stripped out before anything was saved. From here on, the AI, the review card and the saved channel record all see the blanked-out version. The one exception is the next step, which reads the original, because you cannot judge how sensitive a message is after deleting the sensitive part.'
      : 'No social security, tax, card or account number found, so the message carries on untouched.',
    flags: hasPII ? ['REDACTED'] : [],
    decisive: false,
  })

  const forced = preFilterForced(rawMessage)
  trace.push({
    layer: 0,
    title: 'Check the two things a human must always handle',
    technical: 'preFilterForced (Layer 0)',
    kind: 'deterministic',
    verdict: forced
      ? forced === 'pii'
        ? 'Sensitive data, hand it to a person'
        : 'Legal territory, hand it to a person'
      : 'Neither, so the AI gets a turn',
    detail: forced
      ? 'Anything legal, and anything with personal data in it, is decided here by a plain list of words and patterns rather than by the AI. This is a floor the AI cannot lower: whatever it suggests next, the answer to this message is already a quiet hand-off to a person.'
      : 'Nothing here is legal or sensitive enough to decide automatically, so the judgment call passes to the AI.',
    flags: forced ? [`PREFILTER:${forced}`] : [],
    decisive: Boolean(forced),
  })

  // The human-first backstop runs before the model, not after.
  if (opts.humanRepliedDuringHold) {
    trace.push({
      layer: 0,
      title: 'Wait, in case a person answers first',
      technical: 'getLastFunderActivity',
      kind: 'deterministic',
      verdict: 'A teammate already replied',
      detail: `Every message waits ${HOLD_MINUTES} minutes before the assistant may act. A teammate answered inside that window, so this one is dropped entirely: the AI never runs, nothing is spent, and Max never talks over a colleague who is already handling it. The demo resolves the wait instantly instead of making you sit through it.`,
      flags: ['SKIPPED:reply_to_staff'],
      decisive: true,
    })

    trace.push(outcomeStep('skipped', false))

    return {
      rawMessage,
      redactedMessage,
      redacted: hasPII,
      plan: { action: 'stay_out', flags: ['SKIPPED:reply_to_staff'], reasoning: 'a teammate replied during the hold' },
      trace,
      outboundText: null,
      status: 'skipped',
      headline: 'A teammate got there first, so Max stayed out of it.',
      handledBy: 'human',
    }
  }

  trace.push({
    layer: 0,
    title: 'Wait, in case a person answers first',
    technical: 'getLastFunderActivity',
    kind: 'deterministic',
    verdict: `Nobody did in ${HOLD_MINUTES} minutes`,
    detail: `Every message waits ${HOLD_MINUTES} minutes before the assistant may act, so a colleague always gets first crack. Nobody picked this one up, so it is genuinely unattended and the AI gets a turn. The demo resolves the wait instantly instead of making you sit through it.`,
    flags: [],
    decisive: false,
  })

  // Layer 1: the model. Simulated here, but it receives exactly what production
  // sends it: the redacted text, never the raw paste.
  const decision: ReplyDecision = opts.modelFailed
    ? {
        action: 'divert_borderline',
        linkIntent: null,
        replyText: null,
        sensitivityCategory: null,
        needsSilent: false,
        reasoning: 'the model call failed, so the safe fallback applied',
        degraded: 'api_error',
      }
    : opts.modelOverride ?? simulateModel(redactedMessage)

  // Layer 2 runs before the model's trace step is written, so that step can say
  // honestly whether it was the last word.
  const plan = planDispatch(decision, forced)
  const downgraded = decision.action === 'reply' && plan.action !== 'reply'

  trace.push({
    layer: 1,
    title: 'Ask the AI what to do',
    technical: 'decideReply (Layer 1)',
    kind: 'model',
    verdict: plainAction(decision.action),
    detail: opts.modelFailed
      ? 'The model call failed outright: a timeout, an outage, or a malformed answer. That is not treated as permission to guess. A failure always resolves to the cheapest mistake, which is a person seeing a draft, never a silent automatic send.'
      : forced
        ? `The AI still runs and it suggested "${plainAction(decision.action)}", but the previous step already settled this one. Its answer can only narrow the outcome, never widen it.`
        : `${capitalize(decision.reasoning)}. The AI works from a short list of things it is allowed to answer alone. Anything not on that list goes to a person, and when it is unsure, the rule is to hand off.`,
    flags: decision.degraded ? [`DEGRADED:${decision.degraded}`] : [],
    decisive: !forced && !downgraded,
  })

  trace.push({
    layer: 2,
    title: "Check the AI's own words before anyone sees them",
    technical: 'planDispatch + checkCompliance (Layer 2)',
    kind: 'deterministic',
    verdict: downgraded ? 'Overruled the AI' : plainAction(plan.action),
    detail: buildLayer2Detail(plan.action, plan.flags, downgraded),
    flags: plan.flags,
    decisive: downgraded,
  })

  // Render the outbound text, if there is any.
  let outboundText: string | null = null
  let status: DraftStatus

  if (plan.action === 'reply' && plan.linkIntent) {
    outboundText = renderTransactional(
      plan.linkIntent,
      opts.clientFirstName,
      opts.advisorName,
      opts.advisorMention,
      opts.slots
    )
    status = 'auto_sent'
  } else if (plan.action === 'reply' && plan.replyText) {
    outboundText = plan.replyText
    status = 'auto_sent'
  } else if (plan.action === 'divert_sensitive') {
    outboundText = plan.needsSilent
      ? null
      : handoffAck(opts.clientFirstName, plan.sensitivityCategory ?? null)
    status = 'awaiting_human'
  } else if (plan.action === 'divert_borderline') {
    outboundText = plan.replyText ?? null
    const tripped = plan.flags.some(
      (f) => f.startsWith('COMPLIANCE:') || f === 'AUTO_BLOCKED' || f === 'GENERATED_LINK'
    )
    status = tripped ? 'blocked' : outboundText ? 'pending' : 'awaiting_human'
  } else {
    status = 'skipped'
  }

  // Outside business hours the client gets a short acknowledgement instead of
  // being left in silence overnight, and only when nothing else is being sent.
  if (opts.afterHours && status === 'awaiting_human' && !outboundText && !plan.needsSilent) {
    outboundText = afterHoursAck(opts.clientFirstName)
    trace.push({
      layer: 2,
      title: 'It is outside business hours',
      technical: 'shouldAfterHoursAck',
      kind: 'deterministic',
      verdict: 'Send a short holding note',
      detail:
        'Nobody is going to answer this tonight, and silence until morning reads as being ignored. So the client gets one plain acknowledgement, capped at one per night, that promises nothing and commits to no timing.',
      flags: ['AFTER_HOURS_ACK'],
      decisive: false,
    })
  }

  // Backstop: anything the assistant is about to say to a client is re-checked.
  if ((status === 'auto_sent' || status === 'awaiting_human') && outboundText) {
    const cleaned = sanitizeDashes(outboundText)
    const finalCheck = checkCompliance(cleaned)
    outboundText = cleaned
    trace.push({
      layer: 2,
      title: 'Check it one last time on the way out',
      technical: 'checkCompliance (outbound)',
      kind: 'deterministic',
      verdict: finalCheck.passed ? 'Cleared to send' : 'Stopped at the door',
      detail: finalCheck.passed
        ? 'Even the fixed, pre-written messages get checked again right before they leave. Those are written by people and people edit them, so nothing that reaches a client skips this.'
        : 'The message tripped the check on its way out, so it is withheld and a person is asked to write it instead.',
      flags: finalCheck.flags,
      decisive: !finalCheck.passed,
    })
    if (!finalCheck.passed) {
      status = status === 'auto_sent' ? 'blocked' : 'awaiting_human'
      if (status === 'awaiting_human') outboundText = null
    }
  }

  trace.push(outcomeStep(status, plan.needsSilent ?? false))

  return {
    rawMessage,
    redactedMessage,
    redacted: hasPII,
    plan,
    trace,
    outboundText,
    status,
    headline: headlineFor(status, plan.needsSilent ?? false, decision.degraded),
    handledBy: status === 'auto_sent' ? 'max' : status === 'skipped' ? 'nobody' : 'human',
  }
}

function capitalize(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

/** Plain-language name for an action, for readers who do not know the enum. */
function plainAction(action: string): string {
  switch (action) {
    case 'reply':
      return 'Answer it myself'
    case 'divert_sensitive':
      return 'Get a person on this'
    case 'divert_borderline':
      return 'Write a draft for a person to check'
    case 'stay_out':
      return 'Say nothing'
    default:
      return action
  }
}

function buildLayer2Detail(planAction: string, flags: string[], downgraded: boolean): string {
  if (flags.some((f) => f.startsWith('PREFILTER:'))) {
    return 'The earlier check already settled this, so whatever the AI suggested is set aside. A person handles it quietly.'
  }
  if (flags.includes('GENERATED_LINK')) {
    return 'The AI tried to write a web link. It is never allowed to do that, because a made-up link is the kind of mistake a client acts on. Links only ever come from fixed, pre-written messages, so this became a draft for a person instead.'
  }
  if (flags.includes('AUTO_BLOCKED')) {
    const named = flags
      .filter((f) => f.startsWith('COMPLIANCE:') || f.startsWith('BANNED_PHRASE:'))
      .map(plainFlag)
    return `The AI wanted to send this itself, but its own wording broke the rules: ${named.join(', ')}. Anything the AI writes gets read by this check before a client can see it, so instead of sending, it became a draft with the problems marked.`
  }
  if (flags.includes('MODEL_EMPTY_REPLY')) {
    return 'The AI chose to answer but produced nothing to say. That resolves to the cheap mistake: a person sees a draft.'
  }
  if (downgraded) {
    return 'The AI wanted to send something. This step read it, decided it was not safe to send unread, and turned it into a draft instead.'
  }
  if (planAction === 'reply') {
    return 'The AI asked for one of the fixed, pre-written messages. That message owns the link, so the AI never types a web address itself.'
  }
  return 'Nothing to overrule. The AI handed off, and this step can only ever narrow an outcome, never widen one.'
}

/** Plain-English reading of a flag code, for the non-engineers in the room. */
export function plainFlag(flag: string): string {
  const map: Record<string, string> = {
    'COMPLIANCE:specific_amount': 'it quoted a specific amount of money',
    'COMPLIANCE:delivery_promise': 'it promised something would be done',
    'COMPLIANCE:guarantee': 'it used the word guarantee',
    'COMPLIANCE:sensitive_digits': 'it contained a sensitive-looking number',
    'BANNED_PHRASE:happy_to': 'it used a stock customer-service phrase',
    'BANNED_PHRASE:happy_to_help': 'it used a stock customer-service phrase',
    'BANNED_PHRASE:as_an_ai': 'it said the words "as an AI"',
    'BANNED_PHRASE:no_problem': 'it used a stock customer-service phrase',
    AUTO_BLOCKED: 'blocked from sending on its own',
    GENERATED_LINK: 'it invented a web link',
    MODEL_EMPTY_REPLY: 'it returned nothing to say',
    'PREFILTER:pii': 'personal data, decided before the AI ran',
    'PREFILTER:legal': 'legal wording, decided before the AI ran',
    'SKIPPED:reply_to_staff': 'a teammate had already replied',
    REDACTED: 'sensitive numbers removed',
    AFTER_HOURS_ACK: 'sent the after-hours note',
    TYPO_DASH: 'it used a typographic dash',
    'DEGRADED:api_error': 'the AI call failed',
  }
  if (map[flag]) return map[flag]
  if (flag.startsWith('TOO_LONG')) return 'it was too long for a chat reply'
  return flag
}

function outcomeStep(status: DraftStatus, silent: boolean): TraceStep {
  return {
    layer: 3,
    title: 'What actually happened',
    technical: 'dispatch',
    kind: 'deterministic',
    verdict: outcomeLabel(status),
    detail: outcomeDetail(status, silent),
    flags: [],
    decisive: false,
  }
}

function outcomeLabel(status: DraftStatus): string {
  switch (status) {
    case 'auto_sent':
      return 'Max answered it himself'
    case 'pending':
      return 'A draft is waiting for one tap'
    case 'blocked':
      return 'A draft with no send button'
    case 'awaiting_human':
      return 'A person was asked to take it'
    case 'skipped':
      return 'Nothing was sent, and nobody was pinged'
    default:
      return status
  }
}

function outcomeDetail(status: DraftStatus, silent: boolean): string {
  switch (status) {
    case 'auto_sent':
      return 'A fixed, pre-written message, checked twice, posted in the thread. The team still sees a copy in their internal channel, so nothing Max says to a client is invisible to them.'
    case 'pending':
      return 'The draft is sitting in the internal channel with a Send button. One tap from an authorised teammate posts it to the client, in the same thread.'
    case 'blocked':
      return 'The draft is there for a person to read, but the Send button is not rendered at all. Something that breaks the rules is never one tap away from a client.'
    case 'awaiting_human':
      return silent
        ? 'The client gets nothing at all. For legal and personal-data messages an automatic reply is itself the mistake, so a person handles it quietly and gets alerted with the blanked-out version.'
        : 'The client gets a short note so they are not sitting in silence, and the account lead is pinged internally to reply properly.'
    case 'skipped':
      return 'Choosing to do nothing is a real outcome, and it gets counted in the daily summary exactly like the others.'
    default:
      return ''
  }
}

function headlineFor(status: DraftStatus, silent: boolean, degraded: string | null): string {
  if (degraded) return 'The AI call failed, so Max fell back to a draft for a person.'
  switch (status) {
    case 'auto_sent':
      return 'Max handled this one himself, using a pre-written message.'
    case 'pending':
      return 'Max wrote a draft and left it for a person to send.'
    case 'blocked':
      return 'Max wanted to send something it should not have. The draft has no send button.'
    case 'awaiting_human':
      return silent
        ? 'Max said nothing to the client and quietly alerted a person.'
        : 'Max acknowledged the client and handed the real reply to a person.'
    case 'skipped':
      return 'Max decided nothing was needed from anyone.'
    default:
      return ''
  }
}
