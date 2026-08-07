import { test } from 'node:test'
import assert from 'node:assert/strict'

import { checkCompliance, inboundHasPII, redactPII, sanitizeDashes } from './compliance'
import { planDispatch, preFilterForced, SAFE_ZONE_SYSTEM } from './brain'
import { simulateModel, legacyWouldAutoSend } from './simulate'
import { runPipeline, plainFlag } from './pipeline'
import { SCENARIOS } from '../scenarios'
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
  assert.equal(checkCompliance('That extra scope runs $4,500.').passed, false)
  assert.equal(checkCompliance('The build will cost about 12k.').passed, false)
  assert.equal(checkCompliance('That is a six figure engagement.').passed, false)
  assert.equal(checkCompliance('We billed roughly fifteen thousand for that phase.').passed, false)
})

test('compliance allows a bare number with no money context', () => {
  const check = checkCompliance('Your call is on the 2026 calendar, room 4.')
  assert.equal(check.passed, true, `unexpected flags: ${check.flags.join(', ')}`)
})

test('compliance blocks a promised delivery', () => {
  assert.equal(checkCompliance("We'll definitely have it delivered by Friday.").passed, false)
  assert.equal(checkCompliance('That launch date is locked in.').passed, false)
  assert.equal(checkCompliance('I guarantee this works out.').passed, false)
  assert.equal(checkCompliance('It will be done tomorrow.').passed, false)
})

test('compliance allows a plain factual update with no promise', () => {
  const check = checkCompliance('The design review notes are in the shared folder now.')
  assert.equal(check.passed, true, `unexpected flags: ${check.flags.join(', ')}`)
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
  const text = "We'll definitely have it delivered by Friday."
  const plan = planDispatch(decision({ action: 'reply', replyText: text }), null)
  assert.equal(plan.action, 'divert_borderline')
  assert.ok(plan.flags.includes('AUTO_BLOCKED'))
  assert.ok(plan.flags.includes('COMPLIANCE:delivery_promise'))
  assert.equal(plan.replyText, text)
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

test('asking for a commitment is diverted, not answered', () => {
  const result = runPipeline('Can you promise the checkout work will be done by Friday?', OPTS)
  assert.equal(result.plan.action, 'divert_sensitive')
  assert.equal(result.plan.sensitivityCategory, 'commitment')
  assert.notEqual(result.status, 'auto_sent')
})

test('a reported problem always goes to a human', () => {
  const result = runPipeline('Staging is throwing a 500 on the payment step, nothing is going through', OPTS)
  assert.equal(result.plan.action, 'divert_sensitive')
  assert.equal(result.plan.sensitivityCategory, 'problem')
})

test('a pricing question is diverted as money, never answered with a figure', () => {
  const result = runPipeline('How much is the extra checkout work going to cost?', OPTS)
  assert.equal(result.plan.action, 'divert_sensitive')
  assert.equal(result.plan.sensitivityCategory, 'money')
  assert.notEqual(result.status, 'auto_sent')
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
  const result = runPipeline('Staging is throwing a 500 on the payment step', OPTS)
  assert.equal(result.status, 'awaiting_human')
  assert.ok(result.outboundText)
  assert.equal(checkCompliance(result.outboundText!).passed, true)
  // Match on the technical name, not the user-facing title: reworded copy
  // should never fail a behavioural test.
  assert.ok(
    result.trace.some((s) => s.technical === 'checkCompliance (outbound)'),
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

// The added scenarios, and the plain-language layer over them.

test('legal wording is silent and decided before the model runs', () => {
  const result = runPipeline(
    'I have asked our attorney to look at the contract before we go any further.',
    OPTS
  )
  assert.equal(result.plan.sensitivityCategory, 'legal')
  assert.equal(result.plan.needsSilent, true)
  assert.equal(result.outboundText, null, 'legal messages get no automated reply at all')
  assert.ok(result.plan.flags.includes('PREFILTER:legal'))
})

test('a complaint is handed over, not answered', () => {
  const result = runPipeline('Honestly we are pretty frustrated with how slow this has been going.', OPTS)
  assert.equal(result.plan.sensitivityCategory, 'complaint')
  assert.notEqual(result.status, 'auto_sent')
})

test('a booking ask carrying bad news does not auto-send', () => {
  const result = runPipeline(
    'Can we get time on the calendar? The staging build is erroring out for me.',
    OPTS
  )
  assert.notEqual(result.status, 'auto_sent')
  assert.equal(result.plan.sensitivityCategory, 'problem')
})

test('each hand-off category gets its own wording', () => {
  const acks = new Set<string>()
  for (const msg of [
    'Staging is throwing a 500 on the payment step',
    'How much is the extra checkout work going to cost us?',
    'Can you promise the checkout work will be done by Friday?',
    'Honestly we are pretty frustrated with how slow this has been going.',
    'Should we go with the new logo or keep the old one?',
  ]) {
    const out = runPipeline(msg, OPTS).outboundText
    assert.ok(out, `expected an acknowledgement for: ${msg}`)
    acks.add(out!)
  }
  assert.equal(acks.size, 5, 'every category should read differently, not one canned line')
})

test('a model failure never auto-sends, it produces a draft', () => {
  const result = runPipeline('Can we push our call to next week?', { ...OPTS, modelFailed: true })
  assert.notEqual(result.status, 'auto_sent')
  assert.ok(result.trace.some((s) => s.flags.includes('DEGRADED:api_error')))
  assert.match(result.headline, /failed/i)
})

test('an invented link is caught even when the model sounds confident', () => {
  const result = runPipeline('Can you send me the scheduling link again?', {
    ...OPTS,
    modelOverride: {
      action: 'reply',
      linkIntent: null,
      replyText: 'Sure, you can book any time at calendly.com/larkfield-goods/check-in.',
      sensitivityCategory: null,
      needsSilent: false,
      reasoning: 'wrote the address from memory',
      degraded: null,
    },
  })
  assert.notEqual(result.status, 'auto_sent')
  assert.ok(result.plan.flags.includes('GENERATED_LINK'))
})

test('after hours, a hand-off gets a holding note instead of silence', () => {
  const result = runPipeline('Quick one, are we still planning to launch this month?', {
    ...OPTS,
    afterHours: true,
  })
  assert.equal(result.status, 'awaiting_human')
  assert.ok(result.outboundText, 'the client should not be left in silence overnight')
  assert.equal(checkCompliance(result.outboundText!).passed, true)
})

test('after-hours never breaks the silence on legal or PII', () => {
  const result = runPipeline('here is my ssn 123-45-6789', { ...OPTS, afterHours: true })
  assert.equal(result.outboundText, null, 'silent categories stay silent even after hours')
})

test('every step carries both a plain reading and a technical name', () => {
  for (const msg of ['thanks!', 'Can I get on your calendar this week?', 'here is my ssn 123-45-6789']) {
    for (const step of runPipeline(msg, OPTS).trace) {
      assert.ok(step.title.length > 0, 'missing plain title')
      assert.ok(step.technical.length > 0, `missing technical name on: ${step.title}`)
      assert.ok(step.verdict.length > 0, `missing verdict on: ${step.title}`)
      // The plain title must not leak the enum vocabulary at a reader.
      assert.doesNotMatch(step.title, /divert_|planDispatch|Layer \d/)
    }
  }
})

test('every outcome produces a headline a non-engineer can read', () => {
  const seen = new Set<string>()
  for (const msg of [
    'Can I get on your calendar this week?',
    'thanks!',
    'here is my ssn 123-45-6789',
    'Staging is throwing a 500 on the payment step',
  ]) {
    const h = runPipeline(msg, OPTS).headline
    assert.ok(h.length > 0)
    assert.doesNotMatch(h, /divert_|auto_sent|planDispatch/)
    seen.add(h)
  }
  assert.ok(seen.size >= 3, 'headlines should distinguish the outcomes')
})

test('every flag has a plain-English reading', () => {
  const codes = [
    'COMPLIANCE:specific_amount',
    'COMPLIANCE:delivery_promise',
    'AUTO_BLOCKED',
    'GENERATED_LINK',
    'PREFILTER:pii',
    'PREFILTER:legal',
    'SKIPPED:reply_to_staff',
    'REDACTED',
    'DEGRADED:api_error',
  ]
  for (const c of codes) {
    assert.notEqual(plainFlag(c), c, `no plain-English reading for ${c}`)
  }
})

// Punctuation robustness. A real model does not care about a missing question
// mark, so the simulation standing in for it must not either.

test('dropping the question mark does not change the answer', () => {
  const questions = [
    'Are we still on for tomorrow at 2?',
    'Did you get the brand files I sent over?',
    'Can I get on your calendar this week?',
    'How much is the extra checkout work going to cost us?',
    'Can you promise the checkout work will be done by Friday?',
    'Where do I submit a new project request?',
    'Any chance we can reschedule Thursday?',
    "What's next after this round?",
  ]
  for (const q of questions) {
    const withMark = runPipeline(q, OPTS)
    const without = runPipeline(q.replace(/\?/g, ''), OPTS)
    assert.equal(
      without.plan.action,
      withMark.plan.action,
      `"${q}" changed answer when the question mark was dropped: ${withMark.plan.action} -> ${without.plan.action}`
    )
    assert.equal(without.status, withMark.status, `"${q}" changed status without its question mark`)
  }
})

test('casing and trailing punctuation do not change the answer', () => {
  const questions = [
    'Are we still on for tomorrow at 2?',
    'Can I get on your calendar this week?',
    'Staging is throwing a 500 on the payment step',
    'Did you get the brand files I sent over?',
  ]
  for (const q of questions) {
    const base = runPipeline(q, OPTS)
    for (const variant of [q.toLowerCase(), q.toUpperCase(), q.trim() + ' ', '  ' + q]) {
      const got = runPipeline(variant, OPTS)
      assert.equal(
        got.plan.action,
        base.plan.action,
        `"${variant}" disagreed with "${q}": ${base.plan.action} -> ${got.plan.action}`
      )
    }
  }
})

test('the built-in scenarios survive being retyped by hand', () => {
  // Exactly what a visitor does: click a case, then type the same thing
  // themselves without the punctuation. The two must agree.
  for (const s of SCENARIOS) {
    if (s.humanRepliedDuringHold || s.modelFailed || s.modelOverride) continue
    const canned = runPipeline(s.message, OPTS)
    const retyped = runPipeline(s.message.replace(/\?/g, '').toLowerCase(), OPTS)
    assert.equal(
      retyped.plan.action,
      canned.plan.action,
      `scenario "${s.label}" behaves differently when retyped: ${canned.plan.action} -> ${retyped.plan.action}`
    )
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
  const reconcile = result.trace.find((s) => s.technical.startsWith('planDispatch'))
  assert.equal(model?.decisive, false, 'the model did not have the last word here')
  assert.equal(reconcile?.decisive, true)
})

// Regressions from stress-testing the demo the way a person actually uses it:
// typing whole sentences into the composer rather than clicking the buttons.

test('a negated request is never acted on', () => {
  for (const msg of [
    'please do NOT cancel our call on thursday',
    'I do not want to reschedule, thursday is fine',
    'no need to cancel, we are all good',
    "don't move the call please",
  ]) {
    const result = runPipeline(msg, OPTS)
    assert.notEqual(result.status, 'auto_sent', `auto-sent on a negated request: ${msg}`)
    assert.equal(result.outboundText, null, `said something back to: ${msg}`)
  }
})

test('the page never claims an acknowledgement it did not send', () => {
  for (const msg of [
    'any update on the homepage',
    'bump',
    'hey are you a bot',
    'here is my ssn 123-45-6789',
    'thanks! also can you send the calendar link',
    'what time is our call again',
  ]) {
    const r = runPipeline(msg, OPTS)
    if (r.outboundText) continue
    assert.doesNotMatch(
      r.headline,
      /acknowledged the client|gets a short note/,
      `headline claims a reply went out, but nothing did: ${msg}`
    )
    const outcome = r.trace[r.trace.length - 1]
    assert.doesNotMatch(
      outcome.detail,
      /gets a short note|not sitting in silence/,
      `outcome step claims a reply went out, but nothing did: ${msg}`
    )
  }
})

test('"down" only means an outage when a verb says so', () => {
  const outage = runPipeline('the staging site is down again', OPTS)
  assert.equal(outage.plan.sensitivityCategory, 'problem')

  for (const msg of [
    "sounds good, I'm down for thursday",
    "let's sit down and go over it next week",
    'I am down in Miami all next week',
  ]) {
    const r = runPipeline(msg, OPTS)
    assert.notEqual(r.plan.sensitivityCategory, 'problem', `read as an outage report: ${msg}`)
    assert.equal(r.outboundText, null, `apologised for a problem that does not exist: ${msg}`)
  }
})

test('a question buried in a status update is never silently dropped', () => {
  const asked = runPipeline('I just submitted the form, can you confirm you got it', OPTS)
  assert.notEqual(asked.status, 'skipped', 'a client question must never resolve to nobody hearing about it')
  assert.equal(asked.handledBy, 'human')

  // A plain status update with no question in it still costs nobody anything.
  const told = runPipeline('just sent over the files', OPTS)
  assert.equal(told.status, 'skipped')
})

test('acknowledgements people actually type are treated as acknowledgements', () => {
  for (const msg of [
    'thanks!',
    'thank you so much',
    'sounds good, thanks',
    'perfect thanks',
    'ok cool',
    'appreciate it',
    'no worries',
    'great, ty',
  ]) {
    const r = runPipeline(msg, OPTS)
    assert.equal(r.status, 'skipped', `escalated a plain thank-you to a person: ${msg}`)
  }
})

test('a Layer 0 decision explains itself, not the model it overruled', () => {
  const pii = runPipeline('here is my ssn 123-45-6789 for the paperwork', OPTS)
  assert.match(pii.plan.reasoning, /personal data/i)
  assert.doesNotMatch(pii.plan.reasoning, /short list/i)

  const legal = runPipeline('I have asked our attorney to look at the contract', OPTS)
  assert.match(legal.plan.reasoning, /legal/i)
})

test('a negated trigger does not fire its category', () => {
  // The client uses the trigger word while saying its opposite. Max must not
  // reply as though the thing happened.
  for (const msg of [
    'nothing is broken on our end, all good',
    'we did not have any problem with the handoff',
    'no need for a refund, we are happy',
    'I am not frustrated, genuinely curious',
    'no questions on the invoice, it all looks right',
    'you do not have to guarantee anything',
    'nothing is out of scope as far as I can tell',
  ]) {
    const r = runPipeline(msg, OPTS)
    assert.equal(r.outboundText, null, `answered a negated statement as if it happened: ${msg}`)
  }
})

test('the negation guard does not suppress a real report', () => {
  // Every one of these carries a negative word AND a genuine issue. Suppressing
  // any of them would be a worse bug than the one the guard fixes.
  const cases: Array<[string, string]> = [
    ['nothing is going through on the upload', 'problem'],
    ['I am not sure if this is a bug, but the upload fails every time', 'problem'],
    ['I do not know why the site is down but it is', 'problem'],
    ['the checkout is not working at all', 'problem'],
    ['no one can access the staging site', 'problem'],
    ['we are not happy with how this is going', 'complaint'],
    ['I do not understand what the invoice is charging me for', 'money'],
    ['I am not asking for a guarantee but will this be done by friday', 'commitment'],
  ]
  for (const [msg, category] of cases) {
    const r = runPipeline(msg, OPTS)
    assert.equal(r.plan.sensitivityCategory, category, `suppressed a real report: ${msg}`)
  }
})

// The stand-down gate. Each of these is a message where a keyword fires but the
// meaning is the opposite, and Max must say nothing to the client.

test('a retraction anywhere in the message stands the rule down', () => {
  for (const msg of [
    'I already have the calendar link, no need to send it again',
    'Thanks for the invoice, no questions from us',
    'The crash we reported yesterday is fixed now, thank you',
    'That timeout cleared up on its own, nothing needed from you',
    'Forget the reschedule, Tuesday is fine',
    'the project form is done, sending it back today',
    'My kid school website is down lol, unrelated',
  ]) {
    const r = runPipeline(msg, OPTS)
    assert.equal(r.outboundText, null, `replied to a retracted message: ${msg}`)
  }
})

test('a what-if never triggers a real action', () => {
  for (const msg of [
    'everything is fine, just want to know the process in case we need to cancel the call last minute',
    'what happens if we need to cancel a meeting down the road',
    'if you ever need to move our call that is fine, just give me a heads up',
    'if the site goes down again who do I call',
    'no worries if you need to push the meeting, we are flexible',
  ]) {
    const r = runPipeline(msg, OPTS)
    assert.notEqual(r.status, 'auto_sent', `acted on a hypothetical: ${msg}`)
    assert.equal(r.outboundText, null, `replied to a hypothetical: ${msg}`)
  }
})

test('somebody else’s meeting is not our meeting', () => {
  for (const msg of [
    'had to cancel my dentist appointment tomorrow so my morning is wide open',
    'I need to reschedule my dentist appointment before our call',
    'Our supplier wants to reschedule their delivery again',
    'We had to push our board meeting to next week so I might be quiet',
    'I need to set up a call with our insurance broker this week',
    "I'll get on a call with my team this afternoon and come back to you",
  ]) {
    const r = runPipeline(msg, OPTS)
    assert.notEqual(r.status, 'auto_sent', `acted on a third-party meeting: ${msg}`)
  }
})

test('a trigger word in its other sense does not fire', () => {
  for (const msg of [
    'I blocked out thursday morning for you',
    "no rush, I'm stuck in back to back meetings today",
    'quick one, how much notice do you need to move the call',
    'all done with this on my end, sent everything over',
    'we are looking at other venues for the offsite',
    "I can guarantee I'll be on the call tuesday",
    'can you push the deck over to me before the meeting',
    "my schedule is packed this week but I'll be on the call",
    'what is your availability next week',
  ]) {
    const r = runPipeline(msg, OPTS)
    assert.equal(r.outboundText, null, `fired on the wrong sense of a keyword: ${msg}`)
  }
})

test('a canned answer never asserts something the client just denied', () => {
  // The receipt reply states a fact. Saying "yes, that came through on our end"
  // to someone reporting the opposite is worse than saying nothing.
  const denied = runPipeline('Did the deck not come through? I do not see it anywhere', OPTS)
  assert.notEqual(denied.status, 'auto_sent')
  assert.equal(denied.outboundText, null)

  // The ordinary form still gets its answer.
  const asked = runPipeline('Did you get the brand files I sent over?', OPTS)
  assert.equal(asked.status, 'auto_sent')
  assert.match(asked.outboundText!, /came through/)
})

test('"if" after a verb of uncertainty is not a hypothetical', () => {
  // "I am not sure if this is a bug" is a live report, not a what-if.
  for (const msg of [
    'I am not sure if this is a bug, but the upload fails every time',
    'let me know if the checkout is still broken on your end',
  ]) {
    assert.equal(runPipeline(msg, OPTS).plan.sensitivityCategory, 'problem', `suppressed: ${msg}`)
  }
})
