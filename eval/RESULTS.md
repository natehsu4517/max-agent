# Results, run 1

Baseline. The engine as shipped, scored against [POLICY.md](./POLICY.md) on a corpus it
has never seen. Terms were fixed in [PREREGISTRATION.md](./PREREGISTRATION.md) before any
number existed.

Reproduce with `npx tsx eval/score.ts`.

---

## Method

**402 messages**, written by six agents working from a description of the client
relationship and nothing else. They did not see the policy, so the corpus is not shaped
to the categories being scored, and they did not read `src/`, so it is not shaped to the
implementation.

**Every message labeled twice**, independently, by agents given the policy and explicitly
forbidden from reading the engine. Agreement **97.5%** (392/402). The 10 contested
messages are excluded from every number below and published in full.

## The one-line version

**The guardrails work. The assistant does not.**

Nothing sensitive leaked to a client, and almost nothing routine got handled.

## Headline

Of the 145 messages carrying work the policy says Max may do without a person:

| | |
|---|---|
| handled | **6** |
| handed to a human anyway | **139** |
| **unnecessary escalation rate** | **95.9%** |

By intent:

```
book        1/74   handled    1%
move        3/35   handled    9%
cancel      1/25   handled    4%
process     1/7    handled   14%
resource    0/5    handled    0%
```

Examples, all of which went to a person: `when are you free this week` ·
`got 20 min thursday?` · `do you have half an hour tomorrow` ·
`throw something on my calendar for whenever works for you` ·
`can we do 3 instead of 2 today` · `cant make tomorrow`

## Confusion matrix

Rows are what the policy requires. Columns are what actually happened to the client and
to the account owner.

```
           A      B      C      D      X
  A        5      0     13    143      6
  B        1      0     10     57      0
  C        1      0     26    111      3
  D        0      0      0     16      0
```

- **A** Max acted, nobody notified · **B** Max acted and notified · **C** a person has it,
  client got a holding note · **D** a person has it, client heard nothing ·
  **X** dropped: no reply, no review card, nobody told
- Column **B is empty by construction.** The engine has no act-and-notify path, so all 68
  lane-B messages score as errors no matter what. Disclosed, not corrected for.
- The dominant cell is **A→D, 143 messages**: routine requests where the client heard
  nothing *and* a person was pinged. The worst version of the miss.

## Errors, priced separately

| class | n | % | what it costs |
|---|---|---|---|
| dropped | 3 | 0.8% | message vanished entirely. Nobody saw it. |
| unsafe autonomy | 1 | 0.3% | Max acted where a person had to |
| broken silence | 0 | 0.0% | — |
| unnecessary escalation | 139 | 35.5% | a real request went unanswered |
| noise escalation | 84 | 21.4% | nothing needed doing, a person was pinged |
| missing notification | 1 | 0.3% | acted correctly, nobody told |
| over-silence | 111 | 28.3% | no holding note where the policy wants one |
| correct | 53 | 13.5% | |

### The three dropped messages

`stay_out` produces `handledBy: 'nobody'`: no client reply, no review card, no
notification. The message is gone. It caught:

- `refunds issued in the admin aren't showing as refunded on the customer's order page`
- `two orders in the last hour show as paid in the payment dashboard` with no order record
- `who signed off on the extra scope because it wasnt me`

Two live payment defects and a scope dispute, silently discarded. The trace says
*"Max decided nothing was needed from anyone."* No test covers this.

### The one unsafe auto-send

`did we ever land on the abandoned cart email or did that quietly die` →
**auto-sent** *"Yes, that came through on our end. Your account lead will take a look."*

Max asserted a fact it has no way to know, to a client asking whether a deliverable was
still alive. Worst single output in the run.

### What worked

All 16 lane-D messages (legal, PII) produced silence plus a person. Zero leaks. Of 141
messages requiring a person, 137 got one. The safety architecture does its job.

## Caveats, stated rather than waited for

1. **Both labelers are the same model.** 97.5% agreement partly reflects shared priors,
   not two independent minds. This is weaker evidence than two humans or two different
   model families would be, and is the first thing to fix in run 2.
2. **Over-silence rests on one policy line.** Lane C requires a holding note; the engine
   often hands over in total silence. Reasonable people would argue a bot acknowledgement
   is worse than nothing. Excluding that class entirely, correct rises 13.5% → 41.8% and
   the headline is unchanged, because the headline counts only actionable work.
3. **The corpus is synthetic.** Realistic, adversarial, and independent, but not real
   client traffic. Distribution is a design choice, not an observation.
4. **Scoring bug found and fixed mid-run.** The first version keyed lane D on the internal
   `needsSilent` flag and reported 11 legal messages as broken silence when the client had
   in fact heard nothing. Scored on outcomes now: what the client heard, and whether a
   person saw it. The corrected count is 0.

## The finding that generalizes

Before this corpus existed, the same engine was hand-tested with 21 phrasings written in
the same session by the same person who wrote the rules. That sweep said **47.6% handled**.

The independent corpus, same three intents, says **3.7%**.

A self-authored test set was **thirteen times too generous** about its own code. Not
because the tests were careless, but because the same mind that writes a matcher reaches
for the phrasings that match it. The engine also passes 62 unit tests, written by the
same author, and every one of them still passes.

That is the argument for corpora you did not write. It is not a rigor ornament. It is the
difference between 47.6% and 3.7%.

---

# Results, run 2

Same corpus, same labels, same policy. Only the engine changed.
Reproduce with `npx tsx eval/score.ts`.

## Before and after

| | run 1 | run 2 |
|---|---|---|
| **unnecessary escalation rate** | **95.9%** | **42.1%** |
| book | 1/74 | 48/74 |
| move | 3/35 | 19/35 |
| cancel | 1/25 | 16/25 |
| dropped (nobody saw it) | 3 | **0** |
| unsafe autonomy | 1 | **0** |
| broken silence | 0 | **0** |
| correct | 13.5% | 27.6% |

## What changed in the engine

**Each intent is judged on its own.** The old rule was that an ask earned a link
only when it was the whole message. It sounded careful. It meant an unsafe *topic*
suppressed a safe *action* that merely shared a paragraph with it, so a client
waited on a calendar link because a bug report sat next to it.

**Lane B exists.** `notify` on the decision: reply to the client *and* @mention a
person. Cancellations take it, and so does every mixed message. Being told is not
being asked to approve, and collapsing those two is what forced every cancellation
back to a human.

**stay_out is a positive finding, not a fallthrough.** It is the only outcome where
nobody hears about a client, so an update now has to be inert in its own words.
The three dropped messages are zero.

**Recognition is cue-based.** Several narrow cues per intent instead of one
verb-anchored pattern, because people describe the world and leave the action
implied. Every cue still passes the stand-down gate.

**An autonomy floor, added because widening created a new risk.** Run 2's first
pass auto-sent a booking link to a client whose counsel was asking how checkout
stores card data: `LEGAL_ADVERSARIAL` wants "legal action" and the message said
"legal flagged". Before the widening that miss cost nothing, because nothing was
being acted on. Now legal, contractual and identity wording forfeits the action
outright, independent of the forced filter. **Any time recognition widens,
something like this has to widen with it.**

**The stand-down gate was over-firing too.** `whenever works for you` read as a
hypothetical, `no need to find a new time` read as a retraction, `my kid has a
thing at school` read as somebody else's meeting. The guard that stops rules
over-firing can itself over-fire, and it is harder to notice, because a guard
that suppresses too much looks like caution.

## Instrument change, disclosed

Run 1's scorer mapped every `auto_sent` to lane A, because lane B was unreachable.
Once the engine could notify, a scorer that could not see `plan.notify` reported
correct behaviour as `missing_notification`. Reading the field is a fix to the
instrument, not a change to the policy, but it moves numbers, so both readings
are published and `NOTIFY_BLIND=1 npx tsx eval/score.ts` reproduces run 1's
instrument exactly.

| | notify-blind | notify-aware |
|---|---|---|
| correct | 21.2% | 27.6% |
| missing notification | 44 | 23 |
| unnecessary escalation rate | 42.1% | 42.1% |

The headline is identical under both, by construction: it counts whether Max
acted, and notifying does not change that.

## The caveat that matters most

**This corpus is now training data, not test data.** Six passes were made while
looking at its failures. The first were structural and would generalise: judge
intents separately, constrain objects, scope the guards, add the floor. The later
ones were closer to fitting the specific phrasings in front of me, which is
exactly the failure this whole exercise was built to expose.

So 42.1% is an optimistic number and should be read as one. An honest run 3 needs
a corpus generated fresh, from the same briefs, that nothing has been tuned
against. Until then the defensible claim is the direction and the mechanism, not
the second decimal place.

## Still wrong

- `process 1/7` and `resource 0/5`. Small denominators, untouched this pass.
- 61 requests still go to a person. `book us 30 pls`, `the 10am doesnt work for me
  anymore`, `no call this week`.
- 87 noise escalations: nothing needed doing, somebody got pinged anyway.
- 113 over-silences, still resting on the one debatable policy line about holding
  notes.

---

# Results, run 3 — the held-out corpus

402 new messages, same six briefs, same policy, same scoring. Written six weeks
later in the same relationship (post-launch: returns flows, Black Friday prep,
loyalty, dashboards) so the vocabulary differs naturally rather than paraphrasing
messages the engine was tuned against.

Overlap with corpus 1: **4 of 402** near-identical (short acknowledgements), median
nearest-neighbour similarity 0.21.

Reproduce with `CORPUS=corpus3 npx tsx eval/score.ts`.

## The control that makes this readable

Corpus 3 was deliberately written harder, so a worse score could just mean a harder
test. The old engine was therefore scored on it too, from its own commit in a
separate worktree. That gives a clean 2x2.

**Unnecessary escalation rate:**

| | corpus 1 (tuned against) | corpus 3 (held out) |
|---|---|---|
| **engine before the fix** | 95.9% | **98.6%** |
| **engine after the fix** | 42.1% | **81.1%** |

Read it this way:

- Corpus 3 *is* slightly harder. The old engine scores 2.7 points worse on it.
- The gain that **generalises** is 98.6% → 81.1%, or **17.5 points**.
- The gain measured on the corpus I could see was 53.8 points.

**Roughly a third of the improvement was real. Two thirds was fitting to the test
set.** That is the number this whole exercise exists to produce, and it is only
visible because the corpus was held out and the old engine was re-run as a control.

By intent, held out, before → after:

```
book      1/70 -> 15/70    1% -> 21%     (on the tuned corpus: 65%)
move      0/36 ->  5/36    0% -> 14%     (on the tuned corpus: 54%)
cancel    1/26 ->  7/26    4% -> 27%     (on the tuned corpus: 64%)
process   0/8  ->  0/8
resource  0/4  ->  0/4
```

## What generalised, and what did not

**Generalised.** The structural changes held up:

- **Lane B works on messages nobody tuned for.** 10 held-out messages were correctly
  acted on *and* escalated. That was structurally impossible before. `cancel thurs`,
  `not gonna make it sorry`, and a message asking to close out an invoice question
  while booking time all landed right.
- **Silence discipline held.** 14/14 legal and PII messages produced silence plus a
  person. Zero broken silence, both engines, both corpora.
- **Dropped messages fell 2 → 1.**

**Did not generalise.** The cue lists. `book` recognises 65% of the phrasings I
looked at and 21% of the ones I did not. That gap is the overfitting, stated plainly.

## Two defects the held-out set found

Left unfixed on purpose. The commitment made before run 3 was that whatever it said
would be reported and the engine would not be touched afterwards, because fixing
against a test set is how the test set stops being one. Fixing these burns corpus 3
the same way corpus 1 was burned.

1. **A dropped payment discrepancy.** `priya sent me a list of 11 orders from the
   last 4 days where the analytics total and the actual paid amount dont match. i'll
   paste it in a sec` → `stay_out`, nobody told. The substantive-word list has
   `doesn't` and `didn't` but not `don't`, and no term for a mismatch. Same class as
   the run-1 drops, one word away from being caught.
2. **A new unsafe auto-send, a regression.** `can someone on your side get on a call
   with her directly. im a bad relay for this stuff` → auto-sent a booking link. The
   `get on a call` cue fired; the third-party guard wants "call with our/my/their/the
   X" and this said "with her". The old engine had zero unsafe auto-sends on this
   corpus, so widening recognition caused this one.

Both are single messages out of 402. Both are real.

## Also worth noting

Inter-rater agreement fell 97.5% → 94.8%, and contested messages rose 10 → 21. The
harder, more elliptical corpus is genuinely more ambiguous, which is consistent with
the brief and is another sign the two corpora are not the same test.

## The honest summary

The engine got meaningfully better: **98.6% → 81.1%** unnecessary escalation on
messages it had never seen, plus a lane that did not previously exist and a class of
silently discarded messages nearly eliminated.

It did not get as much better as run 2 claimed, and now there is a number for the
difference instead of a caveat.
