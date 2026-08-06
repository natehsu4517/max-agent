/** Shared vocabulary for the decision pipeline. Mirrors the production types. */

export type ReplyAction = 'reply' | 'divert_sensitive' | 'divert_borderline' | 'stay_out'
export type LinkIntent = 'book' | 'reschedule' | 'cancel' | 'payout'
export type SensitivityCategory = 'problem' | 'money' | 'legal' | 'complaint' | 'pii' | 'commitment'

/** Raw decision from the model layer, before Layer-2 reconciliation. */
export interface ReplyDecision {
  action: ReplyAction
  linkIntent: LinkIntent | null
  replyText: string | null
  sensitivityCategory: SensitivityCategory | null
  needsSilent: boolean
  reasoning: string
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

/** One layer's verdict, rendered in the trace panel. */
export interface TraceStep {
  layer: 0 | 1 | 2 | 3
  title: string
  /** Whether this step is real deterministic code or the simulated model. */
  kind: 'deterministic' | 'model'
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
}

export interface ReviewCard {
  id: string
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
}
