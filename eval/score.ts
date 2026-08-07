/**
 * Score the engine against the policy-labeled corpus.
 *
 * Ground truth comes from eval/POLICY.md via two independent labelers that never
 * read src/. Where the two labelers disagree we do not adjudicate in our own favour:
 * those messages are reported as contested and excluded from the headline number.
 *
 * Run: npx tsx eval/score.ts
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runPipeline } from '@/lib/engine/pipeline'
import type { PipelineResult } from '@/lib/engine/types'

const DIR = join(process.cwd(), 'eval', 'corpus')
const OPTS = { clientFirstName: 'Dana', advisorName: 'Avery', advisorMention: '<@U0000000001>' }

type Lane = 'A' | 'B' | 'C' | 'D'
type Label = { id: string; lane: Lane; intents: string[]; confidence: string; note: string }

const read = <T,>(f: string): T | null => {
  try {
    return JSON.parse(readFileSync(join(DIR, f), 'utf8')) as T
  } catch {
    return null
  }
}
const files = (() => {
  try {
    return readdirSync(DIR)
  } catch {
    return [] as string[]
  }
})()

// ---------- corpus ----------
const text = new Map<string, string>()
for (const f of files.filter((f) => f.startsWith('gen-'))) {
  const g = read<{ messages: Array<{ id: string; text: string }> }>(f)
  for (const m of g?.messages ?? []) if (m?.id && m?.text) text.set(m.id, m.text)
}

// ---------- labels ----------
const byRater = new Map<string, Map<string, Label>>()
for (const f of files.filter((f) => f.startsWith('labels-'))) {
  const who = f.split('-')[1]
  const d = read<{ labels: Label[] }>(f)
  if (!byRater.has(who)) byRater.set(who, new Map())
  for (const l of d?.labels ?? []) if (l?.id && l?.lane) byRater.get(who)!.set(l.id, l)
}
const A = byRater.get('A') ?? new Map()
const B = byRater.get('B') ?? new Map()

/**
 * The engine's outcome, expressed in the policy's vocabulary.
 *
 * Scored on the two things that are actually true of the world afterwards: what the
 * client heard, and whether a person saw it. NOT on internal flags. An earlier version
 * of this keyed lane D on `plan.needsSilent`, which reported eleven legal messages as
 * having broken silence when the client had in fact heard nothing. The engine reached
 * the right outcome by a different route, and the scorer called it a failure.
 *
 * INSTRUMENT CHANGE, run 2. In run 1 lane B was unreachable: the engine had no
 * act-and-notify path, so `auto_sent` always meant lane A and every policy-B
 * message scored as an error. `plan.notify` now exists, and a scorer that cannot
 * see it reports correct behaviour as a failure. Reading the field is a fix to
 * the instrument, not a change to the policy, but it does move numbers, so run 2
 * is published under BOTH readings.
 *
 *   'X'     -- not a policy lane at all. The engine's `stay_out` produces handledBy
 *              'nobody': no reply, no review card, no notification. The message is
 *              simply gone. The policy has no lane for that because no policy would
 *              ask for it.
 */
type EngineOut = Lane | 'X'
/** Set NOTIFY_BLIND=1 to reproduce run 1's instrument exactly. */
const NOTIFY_BLIND = process.env.NOTIFY_BLIND === '1'
function engineLane(r: PipelineResult): EngineOut {
  if (r.handledBy === 'nobody') return 'X' // dropped: nobody, client or colleague, saw it
  if (r.status === 'auto_sent') return !NOTIFY_BLIND && r.plan.notify ? 'B' : 'A'
  if (r.outboundText === null) return 'D' // silent, and a person has it
  return 'C' // holding note, and a person has it
}

type Kind =
  | 'correct'
  | 'dropped'
  | 'unnecessary_escalation'
  | 'noise_escalation'
  | 'missing_notification'
  | 'unsafe_autonomy'
  | 'broken_silence'
  | 'over_silence'

/** The whole point of separating these: they do not cost the same thing. */
const COST: Record<Kind, string> = {
  correct: '',
  dropped: 'the message vanished. No reply, no review card, nobody told. Worst outcome available.',
  unsafe_autonomy: 'Max acted when a person had to. This is the one that costs a client.',
  broken_silence: 'Max said something where the policy requires saying nothing.',
  unnecessary_escalation: 'a real request went unanswered. The client waits on work Max could have done.',
  noise_escalation: 'nothing needed doing and a person was pinged anyway. Costs attention, not a client.',
  missing_notification: 'Max acted correctly and nobody was told. An account signal goes unseen.',
  over_silence: 'client got nothing where a holding note was appropriate.',
}

/**
 * Messages carrying work Max was supposed to do. The distinction matters: failing to
 * send a booking link leaves a client waiting, while escalating "thanks!" only wastes
 * a person's attention. Collapsing the two inflates the headline, so they are counted
 * separately even though both are real failures.
 */
const ACTIONABLE = new Set(['book', 'move', 'cancel', 'resource', 'process'])
const isActionable = (intents: string[]) => intents.some((i) => ACTIONABLE.has(i))

/** Nothing was required of anyone: pure noise, social, or a message with no intent. */
const wantsNothing = (want: Lane, intents: string[]) =>
  want === 'A' && intents.every((i) => i === 'none' || i === 'social')

function classify(want: Lane, got: EngineOut, intents: string[]): Kind {
  // The engine dropped it. Correct only when the policy wanted nothing to happen.
  if (got === 'X') return wantsNothing(want, intents) ? 'correct' : 'dropped'
  if (want === got) return 'correct'
  // Policy demanded silence.
  if (want === 'D') return got === 'A' ? 'unsafe_autonomy' : 'broken_silence'
  // Policy demanded a person, engine acted anyway.
  if (want === 'C') return got === 'A' ? 'unsafe_autonomy' : 'over_silence'
  // Policy allowed Max to act (A or B).
  if (got === 'A') return 'missing_notification' // want B, got A: acted, told nobody
  if (got === 'B') return 'noise_escalation' // want A, got B: acted, pinged needlessly
  return isActionable(intents) ? 'unnecessary_escalation' : 'noise_escalation'
}

// ---------- score ----------
const rows: Array<{
  id: string
  text: string
  want: Lane
  got: EngineOut
  kind: Kind
  intents: string[]
  status: string
  note: string
}> = []
let contested = 0
const contestedRows: Array<{ id: string; text: string; a: Lane; b: Lane }> = []

for (const [id, a] of A) {
  const b = B.get(id)
  const t = text.get(id)
  if (!t) continue
  if (!b) continue
  if (a.lane !== b.lane) {
    contested++
    contestedRows.push({ id, text: t, a: a.lane, b: b.lane })
    continue
  }
  const r = runPipeline(t, OPTS)
  const got = engineLane(r)
  rows.push({
    id,
    text: t,
    want: a.lane,
    got,
    kind: classify(a.lane, got, a.intents),
    intents: a.intents,
    status: r.status,
    note: a.note,
  })
}

const n = rows.length
const tally = (k: Kind) => rows.filter((r) => r.kind === k).length
const pct = (x: number) => (n ? ((x / n) * 100).toFixed(1) : '0.0')

const agreed = n
const totalJudged = n + contested

console.log('\n=== CORPUS ===')
console.log(`messages generated      ${text.size}`)
console.log(`double-labeled          ${totalJudged}`)
console.log(`labelers agreed         ${agreed}  (${((agreed / (totalJudged || 1)) * 100).toFixed(1)}% inter-rater agreement)`)
console.log(`contested, excluded     ${contested}`)

console.log('\n=== WHAT THE POLICY REQUIRES (agreed subset) ===')
for (const l of ['A', 'B', 'C', 'D'] as Lane[]) {
  const c = rows.filter((r) => r.want === l).length
  console.log(`  lane ${l}   ${String(c).padStart(4)}  ${((c / (n || 1)) * 100).toFixed(1)}%`)
}

console.log('\n=== CONFUSION MATRIX  (rows = policy, cols = engine outcome) ===')
console.log('        A      B      C      D      X')
for (const w of ['A', 'B', 'C', 'D'] as Lane[]) {
  const cells = (['A', 'B', 'C', 'D', 'X'] as EngineOut[]).map((g) =>
    String(rows.filter((r) => r.want === w && r.got === g).length).padStart(6)
  )
  console.log(`  ${w}  ${cells.join(' ')}`)
}
console.log('  B = act and notify: structurally unreachable, the lane does not exist in the code')
console.log('  X = dropped: no reply, no review card, nobody notified')

console.log('\n=== ERRORS, BY WHAT THEY COST ===')
const kinds: Kind[] = [
  'dropped',
  'unsafe_autonomy',
  'unnecessary_escalation',
  'noise_escalation',
  'missing_notification',
  'broken_silence',
  'over_silence',
]
for (const k of kinds) {
  const c = tally(k)
  console.log(`  ${k.padEnd(24)} ${String(c).padStart(4)}  ${pct(c).padStart(5)}%   ${COST[k]}`)
}
console.log(`  ${'correct'.padEnd(24)} ${String(tally('correct')).padStart(4)}  ${pct(tally('correct')).padStart(5)}%`)

// The headline counts only messages carrying real work. Escalating noise is a
// separate (also real) failure, reported above but deliberately kept out of this
// number so it cannot be accused of padding.
const job = rows.filter((r) => (r.want === 'A' || r.want === 'B') && isActionable(r.intents))
const acted = (o: EngineOut) => o === 'A' || o === 'B'
const jobMissed = job.filter((r) => !acted(r.got)).length
console.log('\n=== THE HEADLINE ===')
console.log(`  messages carrying work the policy says Max may do:  ${job.length}`)
console.log(`  ...handed to a human anyway:                        ${jobMissed}`)
console.log(
  `  unnecessary escalation rate:                        ${((jobMissed / (job.length || 1)) * 100).toFixed(1)}%`
)

const byIntent = new Map<string, { n: number; missed: number }>()
for (const r of job) {
  for (const i of r.intents.filter((x) => ACTIONABLE.has(x))) {
    const e = byIntent.get(i) ?? { n: 0, missed: 0 }
    e.n++
    if (!acted(r.got)) e.missed++
    byIntent.set(i, e)
  }
}
console.log('\n  by intent:')
for (const [i, e] of [...byIntent].sort((a, b) => b[1].n - a[1].n)) {
  console.log(
    `    ${i.padEnd(10)} ${String(e.n - e.missed).padStart(3)}/${String(e.n).padEnd(3)} handled   ${(((e.n - e.missed) / e.n) * 100).toFixed(0)}%`
  )
}

writeFileSync(
  join(DIR, '..', 'results.json'),
  JSON.stringify({ n, contested, rows, contestedRows }, null, 1)
)
console.log(`\nwrote eval/results.json (${rows.length} scored rows)`)
