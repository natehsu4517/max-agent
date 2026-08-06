# Max — a draft-first Slack assistant

An AI assistant that lives in shared client Slack channels. It answers a narrow band of routine
scheduling questions on its own using fixed templates, and turns everything else into a draft a
human taps to send.

**Live demo:** [max-agent-nine.vercel.app](https://max-agent-nine.vercel.app)

The interesting part is not that it drafts replies. It is the shape of the safety around the model:

```
inbound message
      |
  [ redact ]            deterministic — strips PII before anything downstream reads it
      |
  [ Layer 0 ]           deterministic — legal / PII force a silent hand-off, outranking the model
      |
  [ backstop ]          deterministic — 10 min hold; if a human replied, the model never runs
      |
  [ Layer 1 ]           the model — an allowlist prompt that fails closed
      |
  [ Layer 2 ]           deterministic — re-checks the model's own words, downgrades what trips
      |
   outcome
```

Layers 0 and 2 can only ever *narrow* what Layer 1 decided. There is no path where the model widens
its own authority, which means the failure mode of a bad model call is a wasted draft rather than a
message a client should never have received.

## What this repo is

A rebuild of a system I built and run in production for a client. It is not a copy of that
deployment: the client, the advisor, the firm, and every message here are invented, and nothing in
this repo touches real data or real credentials.

**What is the production logic:**

- `src/lib/engine/compliance.ts` — the compliance filter and PII redaction. The detection
  strategies are the production ones (context-gated amount matching, hard-versus-soft certainty,
  banned phrases, collapsed digit runs); the word lists are retargeted to a generic
  client-services vocabulary for this demo.
- `src/lib/engine/brain.ts` — `preFilterForced` (Layer 0) and `planDispatch` (Layer 2) unchanged,
  plus the safe-zone system prompt with the same structure and rule order

**What is simulated:**

- `src/lib/engine/simulate.ts` — Layer 1. In production this is a Sonnet call with a forced JSON
  schema. Here it is a deterministic function applying the rules that prompt states, so the demo
  runs with no API key, costs nothing, and answers identically every time.

That boundary is drawn on the page itself rather than hidden. Type your own message into the demo
and the regexes judging it are the real ones.

The demo is written to be readable without knowing any of this. Every step explains itself in plain
language first, with the function name an engineer would grep for underneath it.

## The cases worth clicking

Nineteen scenarios, grouped by what they demonstrate. The interesting ones:

**The mixed cancel.** "Cancel my call, but I'll circle back with times." This is a real regression.
The system before this one was a single-word intent classifier, and one token cannot represent a
message that says two things at once. It returned `cancel` and auto-sent a cancel-plus-rebook-link
template at a client who had just said they would handle the rebooking. The demo shows both the
current decision and what the old classifier would have done.

**When the model misbehaves.** The model ignores its prompt and writes a confident reply quoting a
price and promising a delivery date. It wants to send. It never gets to: Layer 2 reads its output,
trips three compliance rules, and renders a card with no send button at all. This is the only
reason Layer 2 exists, and it is the case worth understanding.

**A human gets there first.** The same booking question, but a teammate replies during the hold. The
model never runs. Doing nothing is a real outcome, and the cheapest one.

**A pasted SSN.** Redacted before storage, never shown to the model, and met with deliberate
silence, because an automated "got it!" is itself the wrong response to a client pasting an SSN
into a channel.

**The AI is down.** An outage is not permission to guess. Every failure resolves the same way a
bad answer does: a person sees a draft, and nothing goes out on its own.

**Sent at 11pm.** Nobody is answering tonight, and silence until morning reads as being ignored, so
the client gets one short note that promises nothing. Legal and PII stay silent even then.

## What it does inside Slack

Beyond drafting, the behaviours the demo exercises are the ones that make it survivable in a
channel a client is actually reading:

- **Replies in thread**, not in the main channel, so a shared channel does not fill with bot chatter
- **Escalation bridges** post internally with an @-mention and a jump link, never in the client
  channel, and a teammate clears one with a reaction
- **Labeled links only** (`<url|label>`), because the model is never allowed to emit a URL
- **A daily scorecard** that tallies what happened, including the decisions to do nothing. Click
  "Post scorecard" after running a few cases and it counts your session. A zero-activity day still
  posts, so a broken assistant and a calm one never look the same.

## Design notes

A few decisions that took the most thought:

**The hold is a feature, not latency.** Every inbound message waits 10 minutes before the assistant
may act, and the first thing checked after the hold is whether a human already replied. Most
messages in an active channel are answered by a person, so most messages cost zero tokens and the
assistant never talks over an engaged teammate.

**The model may never write a URL.** A transactional reply sets a `link_intent` and a deterministic
template renders the message that carries the link. Generated prose containing anything URL-shaped
is downgraded to a human draft. A model that cannot emit links cannot invent one.

**Compliance failure removes the button, not just the blessing.** A draft that trips the filter is
rendered with Dismiss only. Being one careless tap away from sending a non-compliant message is a
different risk from being warned about it.

**Silence is a valid output, and it is categorized.** `stay_out` for a bare thank-you,
`needs_silent` for legal and PII. Both are counted, so a quiet day and a broken assistant do not
look the same in the daily scorecard.

## Running it

```bash
npm install
npm run dev
```

```bash
npm test
```

45 tests: every compliance rule, PII detection in each common grouping, the Layer 0 override, the
compliance downgrade, the hallucinated-link guard, and end-to-end assertions for each demo case.
The safe-zone prompt is pinned by a test, so deleting one of its guardrails fails CI. A test also
asserts that each hand-off category is worded differently, because one generic line for every
situation is what makes an assistant feel like a machine.

## Stack

Next.js 16, TypeScript, Tailwind v4. No database, no API keys, no network calls: the whole demo is
static and runs client-side.

---

Built by [Nate Hsu](https://github.com/natehsu4517).
