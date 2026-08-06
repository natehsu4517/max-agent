/**
 * Scripted scenarios. Every message here is invented for the demo: no real
 * client, no real conversation, no real business data.
 *
 * Each one is a case the production system actually had to handle, rebuilt as
 * fiction. The two marked `fromProduction` are regressions that shipped, got
 * caught, and drove a redesign.
 */

import type { ReplyDecision } from '../engine/types'

export interface Scenario {
  id: string
  label: string
  /** The one-line reason this case is interesting. */
  premise: string
  message: string
  /** A teammate posts during the 10-minute hold. */
  humanRepliedDuringHold?: boolean
  /** This case is a rebuilt production incident, not a hypothetical. */
  fromProduction?: boolean
  /** Force a specific model decision, to show Layer 2 catching a bad one. */
  modelOverride?: ReplyDecision
}

export const CLIENT = {
  firstName: 'Dana',
  fullName: 'Dana Whitfield',
  company: 'Whitfield Studio',
}

export const ADVISOR = {
  name: 'Avery',
  mention: '@avery',
}

/** Prior channel history, so the panes are not empty on load. */
export const CHANNEL_HISTORY = [
  {
    id: 'h1',
    author: ADVISOR.name,
    authorRole: 'human' as const,
    text: `Morning ${CLIENT.firstName}, your check-in call is on for tomorrow at 2. I will bring the updated summary.`,
    at: -37,
  },
  {
    id: 'h2',
    author: CLIENT.firstName,
    authorRole: 'client' as const,
    text: 'Perfect, thanks Avery.',
    at: -33,
  },
]

export const SCENARIOS: Scenario[] = [
  {
    id: 'mixed-cancel',
    label: 'The mixed cancel',
    premise:
      'A cancel plus "I will handle the rebooking myself." The one-word classifier this replaced saw the word cancel and fired a rebook link at someone who had just said not to.',
    message: "Hey, can you cancel my call for tomorrow? I'll circle back with some new times later this week.",
    fromProduction: true,
  },
  {
    id: 'clean-book',
    label: 'A clean booking ask',
    premise: 'The whole message is the ask, so the assistant answers it alone using a fixed template that owns the link.',
    message: 'Can I get on your calendar this week?',
  },
  {
    id: 'human-first',
    label: 'A human gets there first',
    premise:
      'The same booking ask, but a teammate replies during the 10-minute hold. The model never runs, and nothing is spent.',
    message: 'Can I get on your calendar this week?',
    humanRepliedDuringHold: true,
  },
  {
    id: 'pii-paste',
    label: 'A pasted SSN',
    premise:
      'Redacted before storage, never shown to the model, and deliberately met with silence: an automated reply here is itself the mistake.',
    message: 'here is my ssn 123-45-6789 for the application, let me know if you need anything else',
  },
  {
    id: 'guarantee',
    label: 'Asking for a guarantee',
    premise: 'The kind of question that is easy to answer and expensive to answer wrong, so it is never answered automatically.',
    message: 'Will I definitely get approved if I apply this month?',
  },
  {
    id: 'problem',
    label: 'A problem report',
    premise: 'Bad news always goes to a person. This is the most important rule in the prompt.',
    message: 'I got denied again on the second application, not sure what to do here',
    fromProduction: true,
  },
  {
    id: 'model-misbehaves',
    label: 'When the model misbehaves',
    premise:
      'The interesting case. Here the model ignores its prompt and writes a confident reply quoting an amount and promising approval. It is wrong, it wants to send, and it never gets to: the layer underneath it reads its words and takes the send button away. This is the only reason that layer exists.',
    message: 'How much do you think I can get approved for this quarter?',
    modelOverride: {
      action: 'reply',
      linkIntent: null,
      replyText:
        "You're definitely getting approved this quarter, probably around $50,000 based on your file. I'd be happy to walk you through it.",
      sensitivityCategory: null,
      needsSilent: false,
      reasoning: 'the model read this as a simple question it could answer directly',
      degraded: null,
    },
  },
]
