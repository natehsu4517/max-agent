/**
 * Scripted scenarios. Every message here is invented for the demo: no real
 * client, no real conversation, no real business data.
 *
 * Grouped by what they demonstrate, because a flat wall of buttons hides the
 * one thing worth understanding: the assistant answers a small, boring set of
 * things by itself, and the whole rest of the design is about handing off well.
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
  /** The message arrives outside business hours. */
  afterHours?: boolean
  /** The model call itself fails. */
  modelFailed?: boolean
  /** Force a specific model decision, to show the check underneath catching it. */
  modelOverride?: ReplyDecision
}

export interface ScenarioGroup {
  id: string
  title: string
  blurb: string
  scenarios: Scenario[]
}

export const CLIENT = {
  firstName: 'Dana',
  fullName: 'Dana Whitfield',
  company: 'Larkfield Goods',
  initials: 'DW',
}

export const ADVISOR = {
  name: 'Avery',
  fullName: 'Avery Cole',
  mention: '@avery',
  initials: 'AC',
  role: 'account lead',
}

/** Prior channel history, so the panes are not empty on load. */
export const CHANNEL_HISTORY = [
  {
    id: 'h1',
    author: ADVISOR.fullName,
    authorRole: 'human' as const,
    text: `Morning ${CLIENT.firstName}, the new checkout flow is on staging for you to look at. Our check-in call is tomorrow at 2.`,
    at: -37,
  },
  {
    id: 'h2',
    author: CLIENT.fullName,
    authorRole: 'client' as const,
    text: 'Perfect, thanks Avery. Taking a look this afternoon.',
    at: -33,
    reactions: [{ emoji: '👍', count: 1 }],
  },
]

export const GROUPS: ScenarioGroup[] = [
  {
    id: 'routine',
    title: 'Answers it alone',
    blurb:
      'The short list of things Max is allowed to handle without asking anyone. All of them are scheduling or pointing at something the client already has.',
    scenarios: [
      {
        id: 'clean-book',
        label: 'Book a call',
        premise:
          'The whole message is the ask, so Max answers it alone, in thread, with a pre-written message that owns the link.',
        message: 'Can I get on your calendar this week?',
      },
      {
        id: 'reschedule',
        label: 'Move a call',
        premise: 'Same safe zone, different fixed message. Max never types the link itself.',
        message: 'Any chance we can reschedule Thursday?',
      },
      {
        id: 'request-form',
        label: 'Ask for the request form',
        premise: 'A pure logistics ask, answered with the one form link Max is allowed to send.',
        message: 'Where do I submit a new project request?',
      },
      {
        id: 'process-q',
        label: 'A simple question',
        premise:
          'Max may write a short answer of its own here, because nothing about it commits the firm to anything. Note it still gets read by the checks before it sends.',
        message: 'Did you get the brand files I sent over?',
      },
      {
        id: 'confirm',
        label: 'Confirm a booking',
        premise:
          'Confirming something already on the calendar makes no new promise, so it stays inside the safe zone.',
        message: 'Are we still on for tomorrow at 2?',
      },
      {
        id: 'gratitude',
        label: 'Just a thank-you',
        premise:
          'Nothing is needed from anyone. Saying nothing is a real decision here, and it gets counted like any other.',
        message: 'thanks!',
      },
    ],
  },
  {
    id: 'judgment',
    title: 'Judgment calls',
    blurb:
      'Messages that look routine and are not. This is where the previous version of this system got things wrong.',
    scenarios: [
      {
        id: 'mixed-cancel',
        label: 'Cancel, but I will rebook',
        premise:
          'A cancel plus "I will handle the rebooking myself." The one-word classifier this replaced saw the word cancel and fired a rebook link at someone who had just said not to.',
        message: "Hey, can you cancel my call for tomorrow? I'll circle back with some new times later this week.",
      },
      {
        id: 'book-plus-problem',
        label: 'A booking plus bad news',
        premise:
          'Half of this is inside the safe zone and half is not. Mixed messages never get the automatic answer, because the safe half is not the important half.',
        message: 'Can we get time on the calendar? The staging build is erroring out for me and I want to talk it through.',
      },
      {
        id: 'human-first',
        label: 'A person answers first',
        premise:
          'The same booking ask, but a teammate replies during the ten-minute wait. The AI never runs at all, and nothing is spent.',
        message: 'Can I get on your calendar this week?',
        humanRepliedDuringHold: true,
      },
      {
        id: 'after-hours',
        label: 'Sent at 11pm',
        premise:
          'Nobody is answering tonight. Silence until morning reads as being ignored, so the client gets one short note that promises nothing.',
        message: 'Quick one, are we still planning to launch this month?',
        afterHours: true,
      },
    ],
  },
  {
    id: 'handoff',
    title: 'Always a person',
    blurb:
      'Four categories Max will never answer on its own, no matter how easy the answer looks. Each gets a different acknowledgement, worded for what the client actually raised.',
    scenarios: [
      {
        id: 'problem',
        label: 'Something is broken',
        premise: 'Bad news always goes to a person. This is the single most important rule in the whole prompt.',
        message: 'Staging is throwing a 500 on the payment step, nothing is going through',
      },
      {
        id: 'money',
        label: 'A pricing question',
        premise:
          'Max is never allowed to say a number to a client. Not an estimate, not a range, not a "roughly".',
        message: 'How much is the extra checkout work going to cost us?',
      },
      {
        id: 'commitment',
        label: 'Asking for a date',
        premise:
          'A delivery date is the easiest thing to answer and the most expensive to answer wrong, so it is never answered automatically.',
        message: 'Can you promise the checkout work will be done by Friday?',
      },
      {
        id: 'complaint',
        label: 'An unhappy client',
        premise:
          'A complaint answered by a bot is a complaint made worse. This one gets a careful acknowledgement and a fast internal ping.',
        message: 'Honestly we are pretty frustrated with how slow this has been going.',
      },
    ],
  },
  {
    id: 'hardstop',
    title: 'Decided before the AI runs',
    blurb:
      'Two categories are too costly to leave to judgment, so they are settled by a plain list of patterns first. The AI cannot overrule this.',
    scenarios: [
      {
        id: 'pii-paste',
        label: 'A pasted SSN',
        premise:
          'Removed before anything is saved, never shown to the AI, and deliberately met with silence: an automated "got it!" is itself the wrong response here.',
        message: 'here is my ssn 123-45-6789 for the contractor paperwork, let me know if you need anything else',
      },
      {
        id: 'legal',
        label: 'Lawyers get mentioned',
        premise:
          'The moment a client says lawyer, an automated reply can become evidence. Max goes completely silent and pings a person immediately.',
        message: 'I have asked our attorney to look at the contract before we go any further.',
      },
    ],
  },
  {
    id: 'failure',
    title: 'When things go wrong',
    blurb:
      'The cases worth building for. An assistant is only as good as what it does on its worst day.',
    scenarios: [
      {
        id: 'model-misbehaves',
        label: 'The AI misbehaves',
        premise:
          'Here the AI ignores its instructions and writes a confident reply quoting a price and promising a date. It is wrong, it wants to send, and it never gets to: the check underneath reads its words and removes the send button. This is the only reason that check exists.',
        message: 'How much is the extra checkout work going to run us, and when will it be done?',
        modelOverride: {
          action: 'reply',
          linkIntent: null,
          replyText:
            "That's about $4,500 of extra scope, and we'll definitely have it delivered by Friday. I'd be happy to walk you through the breakdown.",
          sensitivityCategory: null,
          needsSilent: false,
          reasoning: 'the AI read this as a simple question it could answer directly',
          degraded: null,
        },
      },
      {
        id: 'model-invents-link',
        label: 'The AI invents a link',
        premise:
          'A made-up web address is the kind of mistake a client clicks on. Max is structurally incapable of sending one: any link in generated text sends the message to a person instead.',
        message: 'Can you send me the scheduling link again?',
        modelOverride: {
          action: 'reply',
          linkIntent: null,
          replyText: 'Sure, you can book any time at calendly.com/larkfield-goods/check-in.',
          sensitivityCategory: null,
          needsSilent: false,
          reasoning: 'the AI tried to be helpful and wrote the address from memory',
          degraded: null,
        },
      },
      {
        id: 'model-down',
        label: 'The AI is down',
        premise:
          'An outage is not permission to guess. Every failure resolves the same way: a person sees a draft, and nothing goes out automatically.',
        message: 'Can we push our call to next week?',
        modelFailed: true,
      },
    ],
  },
]

export const SCENARIOS: Scenario[] = GROUPS.flatMap((g) => g.scenarios)
