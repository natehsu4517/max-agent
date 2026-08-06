/**
 * The pipeline, in the order production runs it, emitting a trace step for
 * every layer so the UI can show its work.
 *
 * The ordering is the design. Redaction happens before anything downstream can
 * see the text. The human-first backstop happens before the model, so an
 * engaged human costs zero tokens and the assistant never talks over them. The
 * compliance gate happens after the model, on the model's own words.
 */

import { checkCompliance, inboundHasPII, redactPII, sanitizeDashes } from './compliance'
import { planDispatch, preFilterForced } from './brain'
import { simulateModel } from './simulate'
import { renderTransactional, handoffAck } from './templates'
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
}

/**
 * How long an inbound message is held before the assistant may act.
 *
 * In production a cron drains held rows once this has elapsed. The demo does
 * not wait: it resolves the hold instantly and reports what the drain would
 * have found, which is why the trace says the hold "would have" expired rather
 * than claiming this page sat on the message for ten minutes.
 */
export const REPLY_HOLD_MS = 10 * 60 * 1000
const HOLD_MINUTES = REPLY_HOLD_MS / 60_000

export function runPipeline(rawMessage: string, opts: PipelineOptions): PipelineResult {
  const trace: TraceStep[] = []
  const hasPII = inboundHasPII(rawMessage)
  const redactedMessage = hasPII ? redactPII(rawMessage) : rawMessage

  trace.push({
    layer: 0,
    title: 'PII redaction',
    kind: 'deterministic',
    verdict: hasPII ? 'redacted' : 'nothing to redact',
    detail: hasPII
      ? 'Digit runs matching an SSN, EIN, card, or keyword-gated account number were replaced before storage. The model, the review card and the channel record all see only this redacted text. The pre-filter below is the deliberate exception: it reads the raw message, because sensitivity has to be judged on what the client actually sent.'
      : 'No SSN, EIN, card, or account-shaped digit run found. Text passes through unchanged.',
    flags: hasPII ? ['REDACTED'] : [],
    decisive: false,
  })

  const forced = preFilterForced(rawMessage)
  trace.push({
    layer: 0,
    title: 'Layer 0: deterministic pre-filter',
    kind: 'deterministic',
    verdict: forced ? `forced ${forced}` : 'no forced category',
    detail: forced
      ? `Legal and PII are the two categories that are both unambiguous and catastrophic to auto-answer, so they are decided by regex, not judgment. This is a floor the model cannot lower: whatever it returns, the outcome is a silent hand-off to a human.`
      : 'Nothing matched the legal/adversarial or PII patterns, so the decision passes to the model.',
    flags: forced ? [`PREFILTER:${forced}`] : [],
    decisive: Boolean(forced),
  })

  // The human-first backstop runs before the model, not after.
  if (opts.humanRepliedDuringHold) {
    trace.push({
      layer: 0,
      title: 'Human-first backstop',
      kind: 'deterministic',
      verdict: 'human already replied',
      detail: `Every inbound message is held ${HOLD_MINUTES} minutes before the assistant may act, and the first thing the drain checks is whether a teammate posted during that window. Here one did, so the message is dropped: the model never runs, no tokens are spent, and the assistant never speaks over an engaged human. The demo resolves the hold instantly rather than making you wait it out.`,
      flags: ['SKIPPED:reply_to_staff'],
      decisive: true,
    })

    trace.push({
      layer: 3,
      title: 'Outcome',
      kind: 'deterministic',
      verdict: outcomeLabel('skipped'),
      detail: outcomeDetail('skipped', false),
      flags: [],
      decisive: false,
    })

    return {
      rawMessage,
      redactedMessage,
      redacted: hasPII,
      plan: { action: 'stay_out', flags: ['SKIPPED:reply_to_staff'], reasoning: 'a teammate replied during the hold' },
      trace,
      outboundText: null,
      status: 'skipped',
    }
  }

  trace.push({
    layer: 0,
    title: 'Human-first backstop',
    kind: 'deterministic',
    verdict: `no human replied in ${HOLD_MINUTES} min`,
    detail: `No teammate picked the message up inside the ${HOLD_MINUTES}-minute hold, so it is genuinely unattended and the model gets a turn. The demo resolves the hold instantly rather than making you wait it out.`,
    flags: [],
    decisive: false,
  })

  // Layer 1: the model. Simulated here, but it receives exactly what production
  // sends it: the redacted text, never the raw paste.
  const decision = opts.modelOverride ?? simulateModel(redactedMessage)

  // Layer 2: deterministic reconciliation. Computed before the model's trace
  // step is written, so that step can say honestly whether it was the last word.
  const plan = planDispatch(decision, forced)
  const downgraded = decision.action === 'reply' && plan.action !== 'reply'

  trace.push({
    layer: 1,
    title: 'Layer 1: the model',
    kind: 'model',
    verdict: decision.action,
    detail: forced
      ? `The model still runs, and it returned "${decision.action}", but Layer 0 already decided this one. Its answer cannot widen the outcome.`
      : `${decision.reasoning}. The prompt is an allowlist that fails closed: the model may answer autonomously only inside a narrow safe zone, and everything else diverts to a human.`,
    flags: decision.degraded ? [`DEGRADED:${decision.degraded}`] : [],
    decisive: !forced && !downgraded,
  })

  trace.push({
    layer: 2,
    title: 'Layer 2: reconciliation and compliance',
    kind: 'deterministic',
    verdict: downgraded ? `downgraded to ${plan.action}` : plan.action,
    detail: buildLayer2Detail(decision.action, plan.action, plan.flags, downgraded),
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
    outboundText = plan.needsSilent ? null : handoffAck(opts.clientFirstName)
    status = 'awaiting_human'
  } else if (plan.action === 'divert_borderline') {
    outboundText = plan.replyText ?? null
    // A draft that tripped compliance is Dismiss-only: never one tap from a
    // client. A divert with no draft text at all is also not sendable, because
    // there would be nothing to send.
    const tripped = plan.flags.some(
      (f) => f.startsWith('COMPLIANCE:') || f === 'AUTO_BLOCKED' || f === 'GENERATED_LINK'
    )
    status = tripped ? 'blocked' : outboundText ? 'pending' : 'awaiting_human'
  } else {
    status = 'skipped'
  }

  // Backstop: anything the assistant is about to say to a client is re-checked,
  // including the fixed templates and the hand-off ack, because a template edit
  // is a code change like any other. Nothing client-facing skips this gate.
  if ((status === 'auto_sent' || status === 'awaiting_human') && outboundText) {
    const cleaned = sanitizeDashes(outboundText)
    const finalCheck = checkCompliance(cleaned)
    outboundText = cleaned
    trace.push({
      layer: 2,
      title: 'Outbound re-check',
      kind: 'deterministic',
      verdict: finalCheck.passed ? 'passed' : 'blocked at the door',
      detail: finalCheck.passed
        ? 'The rendered message runs through the same compliance filter one last time before it leaves. Templates are code, and code changes, so nothing client-facing skips this gate.'
        : 'The rendered message tripped the filter on its way out, so it is withheld and a person is asked to write it instead.',
      flags: finalCheck.flags,
      decisive: !finalCheck.passed,
    })
    if (!finalCheck.passed) {
      // Withhold the text rather than sending it; the card keeps the flags.
      status = status === 'auto_sent' ? 'blocked' : 'awaiting_human'
      if (status === 'awaiting_human') outboundText = null
    }
  }

  trace.push({
    layer: 3,
    title: 'Outcome',
    kind: 'deterministic',
    verdict: outcomeLabel(status),
    detail: outcomeDetail(status, plan.needsSilent ?? false),
    flags: [],
    decisive: false,
  })

  return { rawMessage, redactedMessage, redacted: hasPII, plan, trace, outboundText, status }
}

function buildLayer2Detail(
  modelAction: string,
  planAction: string,
  flags: string[],
  downgraded: boolean
): string {
  if (flags.some((f) => f.startsWith('PREFILTER:'))) {
    return 'Layer 0 wins outright. The plan is a silent hand-off regardless of what the model returned.'
  }
  if (flags.includes('GENERATED_LINK')) {
    return 'The model wrote something URL-shaped. Generated prose may never carry a link, because links belong to the deterministic templates, so this was downgraded to a human draft.'
  }
  if (flags.includes('AUTO_BLOCKED')) {
    return `The model wanted to send this itself, but its own words tripped the compliance filter (${flags
      .filter((f) => f.startsWith('COMPLIANCE:') || f.startsWith('BANNED_PHRASE:'))
      .join(', ')}). Un-vetted generated text is never auto-sent, so it becomes a human draft carrying the flags.`
  }
  if (flags.includes('MODEL_EMPTY_REPLY')) {
    return 'The model chose to reply but produced no text. That fails toward the cheap error: a human sees a draft.'
  }
  if (downgraded) {
    return `The model returned "${modelAction}" and reconciliation narrowed it to "${planAction}".`
  }
  if (planAction === 'reply') {
    return 'The model asked for a transactional template, so the deterministic template renders it and owns the link. The model never writes URLs.'
  }
  return 'Nothing to reconcile. The model diverted, and this layer can only ever narrow an outcome, never widen one.'
}

function outcomeLabel(status: DraftStatus): string {
  switch (status) {
    case 'auto_sent':
      return 'sent automatically'
    case 'pending':
      return 'draft awaiting one-tap approval'
    case 'blocked':
      return 'draft is dismiss-only'
    case 'awaiting_human':
      return 'handed to a human'
    case 'skipped':
      return 'no action'
    default:
      return status
  }
}

function outcomeDetail(status: DraftStatus, silent: boolean): string {
  switch (status) {
    case 'auto_sent':
      return 'A fixed template, vetted twice, posted to the client channel. An FYI goes to the review channel so the team sees everything the assistant said.'
    case 'pending':
      return 'The draft is posted to the review channel with Send and Dismiss. One authorized tap sends it, in thread, to the client.'
    case 'blocked':
      return 'The draft is posted with Dismiss only. There is no button that sends it, so a non-compliant message is never one tap from a client.'
    case 'awaiting_human':
      return silent
        ? 'The client gets nothing at all. Legal and PII are handled quietly by a person, because an automated acknowledgement is itself a mistake here. The advisor is alerted with the redacted excerpt.'
        : 'The client gets a brief warm hand-off so they are not left in silence, and the advisor is alerted to reply for real.'
    case 'skipped':
      return 'Nothing was sent and no one was pinged. Choosing to do nothing is a real outcome, and it is counted in the daily scorecard like any other.'
    default:
      return ''
  }
}
