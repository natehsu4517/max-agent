/**
 * Deterministic compliance filter.
 *
 * This runs on the DRAFT before it is ever offered to a human for one-tap send:
 * if anything trips, the draft is marked blocked and the reviewer gets the flags
 * plus a Dismiss-only card (no one-tap Send), so a non-compliant message can
 * never be one tap away from a client.
 *
 * It also scans and redacts INBOUND client messages for PII so the assistant
 * never echoes, stores, or acts on an SSN / bank / card number a client pasted
 * into the channel.
 *
 * Ported verbatim from the system I built and run in production. Every rule
 * below behaves here exactly as it does there: type your own message into the
 * demo and these are the regexes that judge it.
 */

export interface ComplianceCheck {
  passed: boolean
  flags: string[]
}

const BANNED_PHRASES: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /\bi'd be happy to\b/i, name: 'BANNED_PHRASE:happy_to' },
  { pattern: /\bhappy to help\b/i, name: 'BANNED_PHRASE:happy_to_help' },
  { pattern: /\bas an ai\b/i, name: 'BANNED_PHRASE:as_an_ai' },
  { pattern: /\bguarantee(?:d|s)?\b/i, name: 'COMPLIANCE:guarantee' },
  { pattern: /\bpassive income\b/i, name: 'COMPLIANCE:passive_income' },
  { pattern: /\bget rich\b/i, name: 'COMPLIANCE:get_rich' },
]

// Specific-amount detection (independent of a literal '$').
// The assistant is told never to quote a dollar figure to a client, so ANY
// money-shaped token is a block: "$50,000", "150k", "fifty... thousand".
const AMOUNT_NUMERIC = /\$\s?\d|\b\d[\d,]*(?:\.\d+)?\s?(?:k\b|grand\b|thousand\b|million\b|mil\b|figures\b)/i
const AMOUNT_SPELLED = /\b(?:thousand|million)\b/i
// Bare money-shaped figure with no '$' and no k/thousand suffix: a comma-grouped
// number ("150,000") or a 5+ digit run ("50000"). 5+ digits (not 4) so a plain
// year like "2026" doesn't trip it. Only counts in an approval context.
const AMOUNT_BARE = /\b\d{1,3}(?:,\d{3})+\b|\b\d{5,}\b/
// "six figures", "seven figures" and friends are money claims on their own.
const AMOUNT_FIGURES = /\b(?:five|six|seven|eight|nine|multiple)[\s-]?figures?\b/i
// Prefix patterns: leading \b only (no trailing \b) so "approval", "funding",
// "qualify", "approved", "secured" all match the stems.
const FUNDING_CTX = /\b(?:approv|fund|qualif|financ|capital|credit line|loan|secur|get you|land)/i

function tripsSpecificAmount(text: string): boolean {
  if (AMOUNT_NUMERIC.test(text)) return true
  if (AMOUNT_FIGURES.test(text)) return true
  // Bare and spelled-out amounts only count in an approval context
  // ("150,000 in funding", "fifty thousand") so we don't flag "a thousand
  // thanks", a year, or an order number.
  if (AMOUNT_BARE.test(text) && FUNDING_CTX.test(text)) return true
  return AMOUNT_SPELLED.test(text) && FUNDING_CTX.test(text)
}

// Approval-certainty: de-facto guarantees without the word "guaranteed".
// Hard certainty phrases are blocked outright (rarely innocent in client comms);
// soft ones only when they sit next to an approval stem.
const CERTAINTY_HARD = /\b(?:a lock|locked in|sure thing|surefire)\b/i
// No trailing \b: "100%" ends in a non-word char, which a trailing \b would reject.
const CERTAINTY_SOFT = /\b(?:promise(?:d|s)?|definitely|certainly|for sure|rest assured|100\s?%|no doubt|without a doubt)/i
const APPROVAL_CTX = /\b(?:approv|qualif|fund|financ|capital|credit line|loan)/i
const STATES_APPROVED = /\b(?:get|be|you'?re|gonna be|going to be)\s+approved\b/i

function tripsApprovalCertainty(text: string): boolean {
  if (CERTAINTY_HARD.test(text)) return true
  if (STATES_APPROVED.test(text)) return true
  return CERTAINTY_SOFT.test(text) && APPROVAL_CTX.test(text)
}

// "0% interest" must be "0% intro APR".
// Normalize spacing/wording, then require an "intro" qualifier within a window
// on EITHER side of the needle. Also catches "zero percent", "no interest",
// and "interest-free".
function trips0PctInterest(text: string): boolean {
  const norm = text
    .toLowerCase()
    .replace(/zero\s*percent/g, '0%')
    .replace(/0\s*%/g, '0%')
  const needles = ['0% interest', 'no interest', 'interest-free', 'interest free']
  for (const needle of needles) {
    const idx = norm.indexOf(needle)
    if (idx === -1) continue
    const window = norm.slice(Math.max(0, idx - 30), idx + needle.length + 30)
    if (!window.includes('intro')) return true
  }
  return false
}

// Typographic dashes by code point: em (0x2014), en (0x2013), figure (0x2012),
// horizontal bar (0x2015), minus (0x2212). A plain hyphen is fine and left
// alone. Built from code points so this source carries no dash glyphs. Drafts
// run through sanitizeDashes() before checkCompliance, so a TYPO_DASH flag here
// is only a backstop for any path that skips the sanitizer.
const DASH_CLASS = [0x2012, 0x2013, 0x2014, 0x2015, 0x2212].map((c) => String.fromCharCode(c)).join('')
const TYPO_DASH = new RegExp('[' + DASH_CLASS + ']')
const DASH_SPACED = new RegExp(' *[' + DASH_CLASS + '] *', 'g')
const MAX_CHARS = 700

/**
 * Replace typographic dashes with plain punctuation so a client-facing draft
 * never shows one. A spaced or unspaced dash becomes a comma; a dash right
 * before end punctuation drops the comma.
 */
export function sanitizeDashes(text: string): string {
  return text
    .replace(DASH_SPACED, ', ')
    .replace(/,\s*([.!?;:])/g, '$1')
    .replace(/,\s*,/g, ',')
}

// Collapse separators (spaces / hyphens / dots / commas, in ANY run length)
// BETWEEN digits so grouped numbers ("4111 1111 1111 1111", "123-45-6789")
// read as one run for the digit checks below. Multi-separator runs (double
// spaces) are a common paste artifact, so the quantifier is `+`.
function joinDigitGroups(text: string): string {
  return text.replace(/(\d)[ .,-]+(?=\d)/g, '$1')
}

// In the assistant's OWN outbound text, any SSN / EIN / long card-or-account
// run is a flag.
const SENSITIVE_DIGITS = /\b\d{3}-\d{2}-\d{4}\b|\b\d{9,19}\b|\b\d{2}-\d{7}\b/

export function checkCompliance(text: string): ComplianceCheck {
  const flags: string[] = []
  const joined = joinDigitGroups(text)

  if (TYPO_DASH.test(text)) flags.push('TYPO_DASH')
  if (text.length > MAX_CHARS) flags.push(`TOO_LONG:${text.length}`)
  if (trips0PctInterest(text)) flags.push('COMPLIANCE:0pct_missing_intro')
  if (tripsSpecificAmount(text)) flags.push('COMPLIANCE:specific_amount')
  if (tripsApprovalCertainty(text)) flags.push('COMPLIANCE:approval_certainty')
  if (SENSITIVE_DIGITS.test(joined)) flags.push('COMPLIANCE:sensitive_digits')

  for (const { pattern, name } of BANNED_PHRASES) {
    if (pattern.test(text)) flags.push(name)
  }

  return { passed: flags.length === 0, flags }
}

// Inbound PII scan + redaction.
// Catch a client pasting an SSN / EIN / card / account number, including the
// usual grouped forms ("4111 1111 1111 1111", "123 45 6789"). Targeted enough
// that ordinary phone numbers (10-11 digits) don't trip it. When this fires the
// assistant does NOT draft a normal reply, and the raw message is REDACTED
// before it is stored or shown on the review card (never persist plaintext PII).
const INBOUND_PII = /\b\d{3}-\d{2}-\d{4}\b|\b\d{9}\b|\b\d{2}-\d{7}\b|\b\d{13,19}\b/
// A 7 to 12 digit run is account-length (US checking accounts are commonly 7-9
// digits) but also phone/year-length, so it only counts as PII when an
// account/bank keyword sits nearby. This closes the bank-account-number gap
// without flagging a bare phone number.
const ACCOUNT_RUN = /\b\d{7,12}\b/
const ACCOUNT_CTX = /\b(?:account|acct|routing|checking|savings|wire|bank|card|ssn|social|ein)\b/i

export function inboundHasPII(text: string): boolean {
  const joined = joinDigitGroups(text)
  if (INBOUND_PII.test(joined)) return true
  return ACCOUNT_RUN.test(joined) && ACCOUNT_CTX.test(text)
}

// Separators allowed BETWEEN digits when redacting a grouped run. Must mirror
// joinDigitGroups (space/dot/comma/dash, any run length) so anything the
// detector flags is also redactable.
const REDACT_PATTERNS: RegExp[] = [
  /\b\d{3}[ .,-]*\d{2}[ .,-]*\d{4}\b/g, // SSN (grouped with any separators, or not)
  /\b\d{2}-\d{7}\b/g, // EIN
  /\b\d(?:[ .,-]*\d){8,18}\b/g, // any 9-19 digit run (card / account / routing / SSN)
]
// A 7-8 digit run is account-length but also year/phone-fragment length, so it
// is only redacted when an account/bank keyword is present in the same message.
const ACCOUNT_SHORT = /\b\d(?:[ .,-]*\d){6,7}\b/g

/** Replace anything PII-shaped with a placeholder, for safe storage + display. */
export function redactPII(text: string): string {
  let out = text
  for (const re of REDACT_PATTERNS) out = out.replace(re, '[sensitive info removed]')
  // Keyword-gated short account numbers (7-8 digits).
  if (ACCOUNT_CTX.test(text)) out = out.replace(ACCOUNT_SHORT, '[sensitive info removed]')
  return out
}
