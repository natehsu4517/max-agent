/** Shared vocabulary for the decision pipeline. Mirrors the production types. */

export type ReplyAction = 'reply' | 'divert_sensitive' | 'divert_borderline' | 'stay_out'
export type LinkIntent = 'book' | 'reschedule' | 'cancel' | 'request'
export type SensitivityCategory =
  | 'problem'
  | 'money'
  | 'legal'
  | 'complaint'
  | 'pii'
  | 'commitment'
  | 'advice'

/** Raw decision from the model layer, before Layer-2 reconciliation. */
export interface ReplyDecision {
  action: ReplyAction
  linkIntent: LinkIntent | null
  replyText: string | null
  sensitivityCategory: SensitivityCategory | null
  needsSilent: boolean
  reasoning: string
  /**
   * Act AND tell a person, in one move. Non-null is the reason for the ping.
   *
   * The lane that was missing. Without it every message resolved to "Max handles
   * it" or "a person handles it", so a cancellation, which is safe to action and
   * is also the loudest health signal a client ever sends, had to be filed under
   * one or the other. Filing it under "a person handles it" is what made the
   * assistant feel useless; filing it under "Max handles it" loses the signal.
   *
   * A ping is not the FYI card every auto-send already writes. This carries an
   * @mention: notification, not a log entry somebody may read later.
   */
  notify: string | null
  /** Why the decision fell back without a clean model call (null = clean run). */
  degraded: string | null
}

/** The executable plan the dispatcher acts on: a reconciled action plus vetted payload. */
export interface DispatchPlan {
  action: ReplyAction
  /** Reply via the deterministic template for this intent (the template owns the link). */
  linkIntent?: LinkIntent
  /** Reply via generated prose, already sanitized AND compliance-passed. */
  replyText?: string
  sensitivityCategory?: SensitivityCategory
  /** divert_sensitive with no client-facing ack (pii / legal): alert the human only. */
  needsSilent?: boolean
  /** Reply to the client AND ping a person. See ReplyDecision.notify. */
  notify?: string | null
  /** Audit trail: pre-filter hits, compliance flags, downgrade reasons. */
  flags: string[]
  reasoning: string
}

/** How a draft ends up in the review queue. Subset of the production statuses. */
export type DraftStatus =
  | 'held'
  | 'pending'
  | 'blocked'
  | 'sent'
  | 'dismissed'
  | 'auto_sent'
  | 'skipped'
  | 'awaiting_human'

/**
 * One layer's verdict, rendered in the trace panel.
 *
 * Every step carries a plain-English reading and a technical one. The page
 * leads with the plain version, because most people looking at this are
 * evaluating the judgment, not the implementation.
 */
export interface TraceStep {
  layer: 0 | 1 | 2 | 3
  /** Plain-language name for what this step does. */
  title: string
  /** The function or layer name an engineer would grep for. */
  technical: string
  /** Whether this step is real deterministic code or the simulated model. */
  kind: 'deterministic' | 'model'
  /** Plain-language answer: what did this step conclude. */
  verdict: string
  detail: string
  flags: string[]
  /** True when this step decided the outcome on its own. */
  decisive: boolean
}

export interface PipelineResult {
  /** What the client actually typed. Never stored beyond the demo session. */
  rawMessage: string
  /** What every downstream layer, the model included, is allowed to see. */
  redactedMessage: string
  redacted: boolean
  plan: DispatchPlan
  trace: TraceStep[]
  /** The rendered client-facing text, if any is sent or drafted. */
  outboundText: string | null
  /** Whether the outbound text may be sent with one tap, or is Dismiss-only. */
  status: DraftStatus
  /** One plain sentence a non-engineer can read to know what happened. */
  headline: string
  /** Who ended up doing the work. Drives the summary chip. */
  handledBy: 'max' | 'human' | 'nobody'
}

export interface Reaction {
  emoji: string
  count: number
  /** Rendered as "you reacted" styling when a person clicked it in the demo. */
  mine?: boolean
}

export interface ChatMessage {
  id: string
  author: string
  authorRole: 'client' | 'human' | 'assistant' | 'system'
  text: string
  /** Minutes on the demo's synthetic clock. */
  at: number
  /** Present when this message is the redacted rendering of a raw paste. */
  wasRedacted?: boolean
  reactions?: Reaction[]
  /**
   * Replies shown under this message as a Slack thread. The assistant answers
   * in thread rather than in the main channel, so a shared client channel does
   * not fill with bot chatter.
   */
  replies?: ChatMessage[]
}

/**
 * What kind of thing landed in the internal review channel.
 *
 * 'fyi' is a log line for something Max handled: no ping, read it whenever.
 * 'notice' is the lane-B card: Max handled it AND this one is worth your
 * attention now, so it carries an @mention like an escalation does.
 */
export type CardKind = 'draft' | 'escalation' | 'fyi' | 'notice' | 'scorecard'

export interface ReviewCard {
  id: string
  kind: CardKind
  /** The message that produced this card, always redacted. */
  clientMessage: string
  clientName: string
  draftText: string | null
  status: DraftStatus
  flags: string[]
  reasoning: string
  category: SensitivityCategory | null
  needsSilent: boolean
  /** Whether a human may one-tap Send, or only Dismiss. */
  sendable: boolean
  at: number
  /** Who the bridge pings, for escalation cards. */
  mention?: string
  /** Set once a person marks an escalation handled with a reaction. */
  acknowledged?: boolean
  scorecard?: Scorecard
}

/** The daily digest, tallied from what actually happened. */
export interface Scorecard {
  messagesSeen: number
  answeredAutomatically: number
  draftsSent: number
  draftsDismissed: number
  awaitingReview: number
  neededAPerson: number
  piiRedactions: number
  pingsAvoided: number
  blockedByCompliance: number
  saidNothing: number
}
