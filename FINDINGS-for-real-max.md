# What the demo exposed, for the real Max

Written 2026-08-07 after clicking through the demo as a user instead of as its author.
Hand this to the session working on the production Max at MMG.

---

## 1. Audit the safe zone for UNDER-firing. Nobody ever does.

The demo's autonomous zone is four regexes (`TRANSACTIONAL` in `simulate.ts`). Twenty-one
natural phrasings of the only three actions it is allowed to take:

```
BOOK    4/12 auto-sent      CANCEL  3/5 auto-sent      MOVE  2/4 auto-sent
```

Misses include `Do you have any availability Thursday?`, `When is Avery free?`,
`I can't make our call tomorrow.`, `Can we bump our 2pm?`, and
`What does your calendar look like next week?`. All unambiguous, all single-intent,
all handed to a human.

**10 of 21.** More than half the messages the assistant exists to handle, it doesn't.

The lesson I had already written down and applied in one direction only: *a keyword is
not a meaning.* The sensitive rules got five linguistic lenses, a stand-down gate and
62 tests, because a false positive there is a visible embarrassment. The safe zone got
four regexes, because a false negative there is invisible. It just looks like caution.

**Do this on the real Max:** take the last 300 real client messages, run them through,
and split the "went to a human" pile into *should have* and *shouldn't have*. That
second number is the product. Nobody measures it because nothing breaks when it is bad.

## 2. Two lanes where ops needs three

Every message resolves to *Max acts* or *a human acts*. The lane that is missing is
**Max acts and tells someone**, which is where most real CSM work lives.

Case: `can you cancel my call for tomorrow? I'll circle back with new times.`
Currently a draft awaiting a human. There is even a test named
`the mixed cancel does not auto-send a rebook link`, so the complaint is encoded as a
requirement.

The reasoning was that a cancellation is a churn signal the account owner should see.
That is true. But *Avery should know* is not the same as *Avery must press send*, and
collapsing the two is what makes the assistant feel useless. Max can cancel, send the
rebooking link, and post the churn signal internally, in one move.

## 3. Sensitivity vetoes the whole message instead of its own part

Case: `Can we get time on the calendar? The staging build is erroring out for me and
I want to talk it through.`

Two intents. Scheduling, which is safe and is Max's core job. A build failure, which is
genuinely not safe, because Max cannot diagnose it and should not try. Today the second
suppresses the first, so the client waits on a booking link because an unsafe *topic*
was in the same paragraph.

Correct: act on the safe intent, escalate the unsafe one, say both plainly. Max still
never touches the bug.

One caveat worth keeping. Sending a booking link here can *create* work, if the right
answer was "Avery will read your logs and reply in twenty minutes, no call needed." So
the internal ping is not a nicety in this design, it is load-bearing. It has to reach
Avery fast enough to intercept before the client books.

**This needs a definition pass before code.** What counts as safe to act on
unsupervised, per intent, with nulls and multi-intent messages spelled out. It is
exactly the class of question where correct code implementing a wrong definition is
the expensive outcome.

## 4. Every differentiator is defensive, and that is why it reads as a chatbot

Three-layer architecture, layers can only narrow, stand-down gate, decision trace,
scorecard counting pings avoided. All real, all rigorous, all about what the assistant
*does not* do. Restraint is table stakes wearing a feature's clothes. And the autonomous
zone (book, move, cancel, send a form, answer a simple question, acknowledge a
thank-you) is a calendar bot.

The structural cause: the demo shows the assistant at the moment of **one message**.
One in, one out. Nothing with that shape can read as an autonomous CSM, because that
is not what the job is.

The interesting work is across messages and across time:

- nobody answered this client in six days
- the client asked the same question twice and got an answer once
- a date was committed to in this channel and it is now past
- four of the last five messages were problems, and renewal is in 21 days
- the account owner replied to every other client this week but not this one

That is what a CSM lead actually pays for, it is genuinely hard, an LLM over channel
state is genuinely good at it, and it is coverage analysis: the same shape as the
stakeholder-coverage work, pointed at a live channel instead of a closed deal.

**The pitch that follows: the assistant's job is not answering messages. It is making
sure nothing falls through. Replying is the small part.**
