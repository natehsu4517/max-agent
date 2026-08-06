/**
 * The ONLY fixed messages the assistant ever auto-posts to a client channel.
 *
 * Guarantees this module exists to enforce: no dollar figures, no promises, no
 * advice. Every template is re-run through sanitizeDashes + checkCompliance as a
 * backstop before send. The assistant never claims an action it cannot perform,
 * which is why the cancel template mentions a human rather than claiming the
 * cancellation happened.
 *
 * Because the model is forbidden from writing URLs, these templates own every
 * link the client ever receives.
 */

import type { LinkIntent, SensitivityCategory } from './types'

/** Demo URLs. Nothing here resolves to a real booking system. */
export const BOOKING_URL = 'https://example.com/book/check-in'
export const REQUEST_FORM_URL = 'https://example.com/forms/project-request'

function name(first: string | null | undefined): string {
  return first?.trim() || 'there'
}

/** Slack mrkdwn labeled link. */
function linkTo(url: string, label: string): string {
  return `<${url}|${label}>`
}

function slotsSentence(slots: string[] | undefined): string {
  if (!slots || slots.length === 0) return ''
  return ` A few times open right now: ${slots.join(', ')}.`
}

export function bookReply(first: string, advisorName: string, slots?: string[]): string {
  return (
    `Hey ${name(first)}, you can grab a time with ${advisorName} here: ` +
    `${linkTo(BOOKING_URL, 'book a check-in call')}.${slotsSentence(slots)}`
  )
}

export function rescheduleReply(first: string, slots?: string[]): string {
  return (
    `No problem ${name(first)}, you can pick a new time here: ` +
    `${linkTo(BOOKING_URL, 'reschedule your call')}.${slotsSentence(slots)}`
  )
}

/**
 * The assistant has no calendar write access, so it never claims the call is
 * cancelled. It mentions the human who can actually do it.
 */
export function cancelReply(first: string, advisorMention: string): string {
  return (
    `Thanks for the heads up, ${name(first)}. ${advisorMention} will get that call cancelled on our end. ` +
    `When you are ready to pick a new time: ${linkTo(BOOKING_URL, 'book a new time')}.`
  )
}

export function requestReply(first: string): string {
  return (
    `Here is the ${linkTo(REQUEST_FORM_URL, 'project request form')}, ${name(first)}. ` +
    `Please file one per request so it lands in the right queue, and the team will pick it up from there.`
  )
}

export function afterHoursAck(first: string): string {
  return (
    `Thanks ${name(first)}, got your message. The team is offline right now and will pick this up ` +
    `first thing in the morning.`
  )
}

/**
 * The hand-off acknowledgement, worded for what the client actually said.
 *
 * A single generic "someone will follow up" for every case reads like a
 * machine that did not listen. These stay short and promise nothing, but they
 * name the thing the client raised, which is the difference between an
 * acknowledgement and a receipt.
 */
export function handoffAck(first: string, category: SensitivityCategory | null): string {
  const who = name(first)
  switch (category) {
    case 'problem':
      return `Thanks for flagging that, ${who}. I have pulled your account lead in on it now.`
    case 'money':
      // Not "good question": this fires on statements too ("paid the invoice
      // yesterday"), and calling a statement a question reads like a bot.
      return `Your account lead will walk you through the numbers on that one, ${who}, rather than me guessing at them.`
    case 'commitment':
      return `I do not want to give you a date I cannot stand behind, ${who}, so your account lead is picking this up.`
    case 'advice':
      return `That is your account lead's call rather than mine, ${who}. I have passed it to them.`
    case 'complaint':
      return `I hear you, ${who}. Your account lead is looking at this now and will come back to you directly.`
    default:
      return `Thanks ${who}, I have passed this to your account lead and someone will follow up shortly.`
  }
}

/** Dispatcher for the transactional intents. 'request' has no advisor params. */
export function renderTransactional(
  intent: LinkIntent,
  first: string,
  advisorName: string,
  advisorMention: string,
  slots?: string[]
): string {
  switch (intent) {
    case 'book':
      return bookReply(first, advisorName, slots)
    case 'reschedule':
      return rescheduleReply(first, slots)
    case 'cancel':
      return cancelReply(first, advisorMention)
    case 'request':
      return requestReply(first)
  }
}
