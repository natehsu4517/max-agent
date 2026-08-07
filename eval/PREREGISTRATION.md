# Pre-registration

Written **before** the corpus finished generating and before any number was seen.
It exists so the result cannot be quietly reshaped after the fact.

## What is fixed in advance

- **Ground truth is `POLICY.md`,** written before the corpus, independently of the
  implementation. Labelers read the policy and were instructed not to read `src/`.
- **Two independent labelers per message.** Where they disagree, the message is
  **contested** and excluded from the headline number. We do not adjudicate our own
  disagreements in our own favour. The contested count is published.
- **The headline metric is the unnecessary escalation rate:** of the messages the policy
  says Max may act on, the share the engine handed to a human anyway.
- **Errors are reported in five classes, priced separately.** Unsafe autonomy and
  unnecessary escalation are not the same failure and will never be averaged together.
- **Lane B is structurally unreachable by the current engine.** Every message the policy
  puts in lane B is therefore guaranteed to score as an error. This is disclosed rather
  than corrected for, and broken out as its own line.

## What we commit to publishing

Whatever the numbers say, including:

- if the engine is worse than the 10-of-21 hand sweep suggested
- if inter-rater agreement is low, which would mean the policy is underspecified and the
  ground truth is soft
- if the labels turn out to be wrong in places, with the specific cases
- the contested set, as messages, not just as a count

## What would invalidate this

- If the policy is edited after seeing results in a way that moves the headline number,
  that edit and its effect get published alongside the original.
- If a labeler is found to have read the implementation, that batch is discarded and
  re-run.

---

**Appended 2026-08-07, after run 2.** Not an edit: a pre-registration that gets
rewritten once the results are in is worth nothing, so the text above stands as
written. Recording only that the fifth item, "lane B is structurally unreachable
by the current engine", stopped being true when the act-and-notify path was built.
It was accurate for run 1, which is the run these terms were fixed for.
