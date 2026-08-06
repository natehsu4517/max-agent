import { test } from 'node:test'
import assert from 'node:assert/strict'

import { checkCompliance, inboundHasPII, redactPII, sanitizeDashes } from './compliance'
import { planDispatch, preFilterForced, SAFE_ZONE_SYSTEM } from './brain'
import { simulateModel, legacyWouldAutoSend } from './simulate'
import { runPipeline } from './pipeline'
import type { ReplyDecision } from './types'

const OPTS = {
  clientFirstName: 'Dana',
  advisorName: 'Avery',
  advisorMention: '<@U0000000001>',
}

function decision(over: Partial<ReplyDecision>): ReplyDecision {
  return {
    action: 'reply',
    linkIntent: null,
    replyText: null,
    sensitivityCategory: null,
    needsSilent: false,
    reasoning: 'test',
    degraded: null,
    ...over,
  }
}

// Compliance filter

test('compliance blocks a dollar amount in any shape', () => {
  assert.equal(checkCompliance('You should see $50,000 land next week.').passed, false)
  assert.equal(checkCompliance('Expect about 150k once this closes.').passed, false)
  assert.equal(checkCompliance('That is a six figure approval.').passed, false)
  assert.equal(checkCompliance('We secured fifty thousand for a client last week.').passed, false)
})

test('compliance allows a bare number with no money context', () => {
  const check = checkCompliance('Your call is on the 2026 calendar, room 4.')
  assert.equal(check.passed, true, `unexpected flags: ${check.flags.join(', ')}`)
})

test('compliance blocks certainty about approval', () => {
  assert.equal(checkCompliance('You will definitely get approved.').passed, false)
  assert.equal(checkCompliance('That approval is a lock.').passed, false)
  assert.equal(checkCompliance('I guarantee this works out.').passed, false)
})

test('compliance requires 0% to be intro', () => {
  assert.equal(checkCompliance('This card is 0% interest.').passed, false)
  assert.equal(checkCompliance('This card carries a 0% intro APR for 12 months.').passed, true)
})

test('compliance catches banned assistant tells', () => {
  assert.ok(checkCompliance("I'd be happy to help with that.").flags.includes('BANNED_PHRASE:happy_to'))
  assert.ok(checkCompliance('As an AI, I cannot do that.').flags.includes('BANNED_PHRASE:as_an_ai'))
})

test('sanitizeDashes removes typographic dashes', () => {
  const em = String.fromCharCode(0x2014)
  const out = sanitizeDashes(`Your call ${em} the one tomorrow ${em} is confirmed.`)
  assert.equal(out.includes(em), false)
  assert.equal(checkCompliance(out).passed, true)
})

// PII detection and redaction

test('detects an SSN in every common grouping', () => {
  for (const form of ['123-45-6789', '123 45 6789', '123456789', '123.45.6789']) {
    assert.equal(inboundHasPII(`my ssn is ${form}`), true, `missed ${form}`)
  }
})

test('detects a grouped card number but not a bare phone number', () => {
  assert.equal(inboundHasPII('card 4111 1111 1111 1111'), true)
  assert.equal(inboundHasPII('call me at 919 555 0134'), false)
})

test('account-length runs only count with an account keyword', () => {
  assert.equal(inboundHasPII('my checking account is 12345678'), true)
  assert.equal(inboundHasPII('order 12345678 shipped'), false)
})

test('redaction replaces the digits and leaves the sentence readable', () => {
  const out = redactPII('my ssn is 123-45-6789 thanks')
  assert.equal(out.includes('123'), false)
  assert.ok(out.includes('[sensitive info removed]'))
  assert.ok(out.startsWith('my ssn is'))
})

// Layer 0

test('pre-filter forces pii ahead of legal', () => {
  assert.equal(preFilterForced('my lawyer says my ssn 123-45-6789 was leaked'), 'pii')
  assert.equal(preFilterForced('I am talking to my attorney about this'), 'legal')
  assert.equal(preFilterForced('can we move our call to Friday'), null)
})

// Layer 2 reconciliation

test('layer 0 overrides a model that wanted to reply', () => {
  const plan = planDispatch(decision({ action: 'reply', replyText: 'Sure thing.' }), 'legal')
  assert.equal(plan.action, 'divert_sensitive')
  assert.equal(plan.needsSilent, true)
  assert.deepEqual(plan.flags, ['PREFILTER:legal'])
})

test('generated prose that trips compliance is downgraded, never sent', () => {
  const plan = planDispatch(decision({ action: 'reply', replyText: 'You will definitely get approved.' }), null)
  assert.equal(plan.action, 'divert_borderline')
  assert.ok(plan.flags.includes('AUTO_BLOCKED'))
  assert.ok(plan.flags.includes('COMPLIANCE:approval_certainty'))
  assert.equal(plan.replyText, 'You will definitely get approved.')
})

test('a hallucinated link is downgraded', () => {
  const plan = planDispatch(decision({ action: 'reply', replyText: 'Book here: calendly.com/x' }), null)
  assert.equal(plan.action, 'divert_borderline')
  assert.ok(plan.flags.includes('GENERATED_LINK'))
})

test('an empty reply fails toward a human draft', () => {
  const plan = planDispatch(decision({ action: 'reply', replyText: '   ' }), null)
  assert.equal(plan.action, 'divert_borderline')
  assert.ok(plan.flags.includes('MODEL_EMPTY_REPLY'))
})

test('pii and legal are silent even when the model forgets', () => {
  const plan = planDispatch(
    decision({ action: 'divert_sensitive', sensitivityCategory: 'pii', needsSilent: false }),
    null
  )
  assert.equal(plan.needsSilent, true)
})

// The prompt is the rule set, so a drop is a regression

test('safe-zone prompt keeps its load-bearing guardrails', () => {
  for (const needle of [
    'MIXED MESSAGES ARE THE TRAP',
    'THIS IS THE MOST IMPORTANT RULE',
    'you must NOT write a URL',
    'choose divert_borderline',
    'needs_silent=true ONLY for "legal" or "pii"',
  ]) {
    assert.ok(SAFE_ZONE_SYSTEM.includes(needle), `prompt lost: ${needle}`)
  }
})

// End to end

test('the mixed cancel does not auto-send a rebook link', () => {
  const msg = "Hey, can you cancel my call for tomorrow? I'll circle back with some new times later this week."
  const result = runPipeline(msg, OPTS)
  assert.notEqual(result.status, 'auto_sent')
  assert.equal(result.plan.action, 'divert_borderline')
  // And the classifier it replaced would have gotten this wrong.
  assert.equal(legacyWouldAutoSend(msg), true)
})

test('a clean booking ask auto-sends the deterministic template', () => {
  const result = runPipeline('Can I get on your calendar this week?', OPTS)
  assert.equal(result.status, 'auto_sent')
  assert.equal(result.plan.linkIntent, 'book')
  assert.ok(result.outboundText?.includes('example.com'))
  assert.equal(checkCompliance(result.outboundText!).passed, true)
})

test('a human replying during the hold stops the model from ever running', () => {
  const result = runPipeline('Can I get on your calendar this week?', {
    ...OPTS,
    humanRepliedDuringHold: true,
  })
  assert.equal(result.status, 'skipped')
  assert.ok(result.plan.flags.includes('SKIPPED:reply_to_staff'))
  assert.equal(
    result.trace.some((s) => s.kind === 'model'),
    false,
    'the model must not run when a human already replied'
  )
})

test('a pasted SSN is redacted, silent, and never echoed', () => {
  const result = runPipeline('here is my ssn 123-45-6789 for the application', OPTS)
  assert.equal(result.redacted, true)
  assert.equal(result.redactedMessage.includes('123-45-6789'), false)
  assert.equal(result.plan.action, 'divert_sensitive')
  assert.equal(result.plan.needsSilent, true)
  assert.equal(result.outboundText, null, 'the client must get no automated acknowledgement')
  assert.equal(result.status, 'awaiting_human')
})

test('asking for a guarantee is diverted, not answered', () => {
  const result = runPipeline('Will I definitely get approved if I apply?', OPTS)
  assert.equal(result.plan.action, 'divert_sensitive')
  assert.equal(result.plan.sensitivityCategory, 'commitment')
  assert.notEqual(result.status, 'auto_sent')
})

test('a reported problem always goes to a human', () => {
  const result = runPipeline('I got denied again on the second application', OPTS)
  assert.equal(result.plan.action, 'divert_sensitive')
  assert.equal(result.plan.sensitivityCategory, 'problem')
})

test('a bare thanks does nothing at all', () => {
  const result = runPipeline('thanks!', OPTS)
  assert.equal(result.status, 'skipped')
  assert.equal(result.outboundText, null)
})

test('every trace ends with an outcome and marks its decisive step', () => {
  const result = runPipeline('Will I definitely get approved?', OPTS)
  assert.equal(result.trace.at(-1)?.layer, 3)
  assert.ok(result.trace.some((s) => s.decisive))
})

// Regressions found in adversarial review. Each one auto-sent a message it
// should not have, which is the exact failure this system exists to prevent.

test('a smart apostrophe cannot slip a mixed message past the guard', () => {
  // U+2019 is what macOS, iOS and Slack substitute for a typed apostrophe.
  const curly = 'Hey, can you cancel my call for tomorrow? I’ll circle back with some new times later this week.'
  const result = runPipeline(curly, OPTS)
  assert.notEqual(result.status, 'auto_sent')
  assert.equal(result.plan.action, 'divert_borderline')
})

test('self-handling is caught in phrasings other than "I\'ll"', () => {
  const phrasings = [
    "Please cancel tomorrow's call, I'm going to handle rebooking on my own.",
    'Can you cancel my call? I will send you some times later.',
    'Cancel Thursday please, I plan to rebook next week.',
    'Cancel my call, I can find another slot myself.',
  ]
  for (const msg of phrasings) {
    const result = runPipeline(msg, OPTS)
    assert.notEqual(result.status, 'auto_sent', `auto-sent on: ${msg}`)
  }
})

test('a second sentence makes an ask unclean even with no second question mark', () => {
  const result = runPipeline('Cancel tomorrow. I will rebook later this week.', OPTS)
  assert.notEqual(result.status, 'auto_sent')
})

test('a leading greeting does not make a clean ask look mixed', () => {
  const result = runPipeline('Hey! Can I get on your calendar this week?', OPTS)
  assert.equal(result.status, 'auto_sent')
  assert.equal(result.plan.linkIntent, 'book')
})

test('a pending card always has text to send', () => {
  // A "pending" status renders a Send button, so an empty draft would offer a
  // button that sends nothing.
  const probes = [
    'Do you have my documents on file already',
    'Just checking in on where things stand',
    'Following up on the thing we discussed',
  ]
  for (const msg of probes) {
    const result = runPipeline(msg, OPTS)
    if (result.status === 'pending') {
      assert.ok(result.outboundText, `pending with no text to send: ${msg}`)
    }
  }
})

test('the hand-off ack passes the outbound compliance gate like any other message', () => {
  const result = runPipeline('I got denied again on the second application', OPTS)
  assert.equal(result.status, 'awaiting_human')
  assert.ok(result.outboundText)
  assert.equal(checkCompliance(result.outboundText!).passed, true)
  assert.ok(
    result.trace.some((s) => s.title === 'Outbound re-check'),
    'a client-facing ack must go through the outbound re-check'
  )
})

test('only one step in a trace claims it decided the outcome', () => {
  const messages = [
    'Will I definitely get approved?',
    'Can I get on your calendar this week?',
    'here is my ssn 123-45-6789',
    'thanks!',
    'I got denied again',
  ]
  for (const msg of messages) {
    const decisive = runPipeline(msg, OPTS).trace.filter((s) => s.decisive)
    assert.ok(decisive.length <= 1, `${decisive.length} decisive steps on: ${msg}`)
  }
})

test('a model downgrade moves the decision off the model layer', () => {
  const result = runPipeline('How much can I get approved for?', {
    ...OPTS,
    modelOverride: {
      action: 'reply',
      linkIntent: null,
      replyText: "You're definitely getting approved, probably around $50,000.",
      sensitivityCategory: null,
      needsSilent: false,
      reasoning: 'model went off-script',
      degraded: null,
    },
  })
  assert.equal(result.status, 'blocked')
  const model = result.trace.find((s) => s.kind === 'model')
  const reconcile = result.trace.find((s) => s.title.startsWith('Layer 2'))
  assert.equal(model?.decisive, false, 'the model did not have the last word here')
  assert.equal(reconcile?.decisive, true)
})
