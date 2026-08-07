# Autonomy policy v1

The written definition of what Max may do without a person. This document is the
ground truth for labeling the eval corpus. It was written **before** the corpus and
**independently of** the implementation, and labelers never see the engine source.

That separation is the point. The engine currently passes 62 tests written by the same
person who wrote the engine, which is why it can fail more than half its core job and
still look green.

---

## The three lanes, and the silent fourth

Every intent in a message resolves to exactly one lane.

| Lane | Name | Max acts on the client's behalf | A person is notified | Client hears something |
|---|---|---|---|---|
| **A** | act, silently | yes | no | yes (or a reaction) |
| **B** | act, and notify | yes | yes, immediately | yes |
| **C** | hand over | no | yes | a holding note only |
| **D** | hand over, silent | no | yes | **nothing at all** |

Lane B is the one the current engine does not have. Most real account work lives there:
the action is safe and obvious, and the account owner still needs to know it happened.

## Standing principles

1. **Act only when the action is reversible, deterministic, and the intent is unambiguous.**
   Sending a scheduling link is reversible. Quoting a price is not.
2. **Never assert a fact Max cannot verify, never make a commitment, never state a figure.**
3. **Notification is not approval.** "The account owner should know" and "the account
   owner must press send" are different requirements. Conflating them is what makes an
   assistant useless.
4. **Silence has a cost.** A client waiting on something Max could have done safely is a
   failure, not a conservative success. It is counted here as an error.
5. **When genuinely uncertain, hand over.** But uncertainty must be about the *intent*,
   not about the topic being nearby.

## Multi-intent rule

A message may carry more than one intent. **Evaluate each intent independently.**

- Act on every intent whose lane is A or B.
- Hand over every intent whose lane is C.
- If any intent in the message is lane C, the acted-on intents are promoted to lane B.
  The person must be notified immediately, so they can intercept.
- **Lane D overrides everything.** If any intent is D, the whole message is D: no action,
  no client-facing text, even for an otherwise clean scheduling ask. Silence beats
  helpfulness when the topic is legal or the message contains personal data.

The failure this rule exists to prevent: a sensitive *topic* suppressing a safe *action*
that happened to share a paragraph with it.

## Intent catalogue

### Lane A, act silently

- **book** — client asks for time. Send the scheduling link.
- **move / reschedule** — client asks to shift an existing call. Send the link.
- **resource** — client asks for a form, doc, or link they already have access to.
- **process question** — a question about how something works that has a documented,
  non-committal answer ("how do I submit a request?").
- **social** — thanks, acknowledgements, pleasantries. React; do not compose a reply.
  A reply to "thanks!" is noise, and noise is a cost.

### Lane B, act and notify

- **cancel** — client cancels a call. Cancel it, offer the rebooking link, and post the
  cancellation internally. A cancellation is a health signal the account owner needs
  regardless of who sends the reply.
- **any lane A intent in a message that also carries a lane C intent** — per the
  multi-intent rule.
- **scheduling driven by dissatisfaction** — "can we get time, I want to talk about
  where this is going". Book it, and flag it hard.

### Lane C, hand over

- **problem** — a bug, blocker, outage, or anything broken. Max cannot diagnose and must
  not try.
- **money** — pricing, invoices, billing, refunds, discounts, contract value.
- **commitment** — deadlines, delivery dates, scope, guarantees, "will it be ready by".
- **complaint** — dissatisfaction, escalation language, churn signals, comparisons to
  other vendors.
- **advice** — asking Max's opinion or recommendation on their business or the work.
- **ambiguous** — the intent cannot be determined confidently.

### Lane D, hand over silently

- **legal** — lawyers, contracts under dispute, liability, adversarial wording.
- **pii** — the message contains a government ID, card number, bank account, or password.
  Redact on the internal side, say nothing to the client.

## Reading rules for the labeler

These decide the hard cases. All of them are about intent, not keywords.

- **Negation.** "Please do *not* cancel Thursday" carries no cancel intent. Scope the
  negation to its own clause: "I can't make Tuesday, but do not touch Thursday" cancels
  Tuesday only.
- **Hypothetical.** "If we need to reschedule I'll let you know" carries no intent. No
  action. But "I'm not sure if this is a bug, but the upload fails every time" is a live
  problem report, not a hypothetical.
- **Third party.** "My sister's appointment got moved" is not our meeting.
- **Past or resolved.** "The bug we had last week is fixed" is not a live problem.
- **Buried questions.** A question inside a long status update is still a live intent.
- **Idiom.** "The site is down" is a problem; "I'm down for Thursday" is agreement.

## Contentious calls in v1

Flagged because reasonable people would disagree, and because changing them changes the
labels. Every one of these is a policy decision, not a technical one.

1. **Cancel is lane B, not lane C.** The current engine hands cancellations to a person.
   This policy says act and notify.
2. **A booking ask that shares a message with a problem report still gets the link**
   (lane B). Risk accepted: this can manufacture a meeting the account owner would rather
   have resolved in writing. Mitigated only by the notification being immediate.
3. **Thanks gets a reaction, not a reply.** Counted as an action taken, not as silence.
4. **Lane D suppresses a clean booking ask in the same message.** A client who pastes an
   ID and asks for time gets no link until a person handles it.
