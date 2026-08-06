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

import type { LinkIntent } from './types'

/** Demo URLs. Nothing here resolves to a real booking system. */
export const BOOKING_URL = 'https://example.com/book/check-in'
export const REQUEST_FORM_URL = 'https://example.com/forms/payout-request'

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

export function payoutReply(first: string): string {
  return (
    `Here is the ${linkTo(REQUEST_FORM_URL, 'payout request form')}, ${name(first)}. ` +
    `Please submit one form for each account, and the team will take it from there.`
  )
}

export function afterHoursAck(first: string): string {
  return (
    `Thanks ${name(first)}, got your message. The team is offline right now and will pick this up ` +
    `first thing in the morning.`
  )
}

export function handoffAck(first: string): string {
  return `Thanks ${name(first)}, I have passed this to your advisor and someone will follow up shortly.`
}

/** Dispatcher for the transactional intents. 'payout' has no advisor params. */
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
    case 'payout':
      return payoutReply(first)
  }
}
