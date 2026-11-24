import { complete, type Message, type Provider } from './llm'
import type { Recommendation } from './recommend'
import { isObject } from './schema'

/** `source` is the model host, or "template" when no model gave a summary that passed the checks. */
export type Explanation = { summary: string; source: string }

const MAX_SUMMARY = 1200
const SCHEMA = {
  type: 'object',
  properties: { summary: { type: 'string' } },
  required: ['summary'],
  additionalProperties: false,
}

const SYSTEM = `You summarize computed health-price results for an employer benefits manager.
Write 3 to 5 plain sentences using only the FACTS. Copy every number exactly as written in the FACTS.
Do not calculate, round, convert or add numbers. Do not name providers. Do not use markdown.
State the savings and how they split, then what is uncertain.`

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** The results as sentences. These are the model's only source of numbers, and the fallback summary. */
export function factsFrom(r: Recommendation): string[] {
  const { coverage: c, totals: t } = r
  const facts = [`${c.qualifying} of ${plural(c.total, 'procedure')} have enough businesses to compare.`]
  if (r.status === 'coverage_not_met') facts.push('That is below the minimum basket coverage, so no providers are recommended.')
  if (r.status === 'no_feasible_shortlist') facts.push('No shortlist within the provider limit covers them all.')
  if (t) {
    const [unmet, after, oop] = t.split
    facts.push(
      `A shortlist of ${plural(r.providers.length, 'provider')} would cost ${usd.format(t.recommended_spend)} a year, against ${usd.format(t.median_spend)} at the market median.`,
      `That is an estimated saving of up to ${usd.format(t.savings)} a year (${t.savings_percent}%).`,
      `After the deductible is met, the employer keeps ${usd.format(after.employer)} of the saving and employees keep ${usd.format(after.employees)}.`,
      `The employer keeps between ${usd.format(Math.min(unmet.employer, oop.employer))} and ${usd.format(Math.max(unmet.employer, oop.employer))}, depending on where members are in their deductible and out-of-pocket limits.`,
    )
  }
  const excluded = r.procedures.filter((p) => p.reason !== null && p.reason !== 'no_feasible_shortlist')
  if (excluded.length) facts.push(`Too little data to decide on: ${excluded.map((p) => p.description).join('; ')}.`)
  const assumed = r.procedures.filter((p) => p.status === 'recommended' && p.other_variants > 0)
  if (assumed.length) facts.push(`The billing variant was assumed for: ${assumed.map((p) => p.description).join('; ')}.`)
  facts.push('The rate file has no quality, location or capacity data, so the saving is a ceiling.')
  return facts
}

const numbersIn = (text: string) =>
  (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => String(Number(n.replaceAll(',', ''))))

/** Every number must be one of the facts' own, with no "1.2 million" or "$1K" scaling of it. */
export function isGrounded(summary: string, facts: string): boolean {
  const known = new Set(numbersIn(facts))
  return numbersIn(summary).every((n) => known.has(n)) && !/\d\s*(?:k|m|b|thousand|million|billion)\b/i.test(summary)
}

export async function explain(providers: Provider[], r: Recommendation): Promise<Explanation> {
  const facts = factsFrom(r).join(' ')
  const template = { summary: facts, source: 'template' }
  if (r.status !== 'recommended') return template
  // The question is left out: its numbers (headcount, tolerance) end up in the summary and fail the check.
  const messages: Message[] = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `FACTS: ${facts}` },
  ]
  try {
    const { data, provider } = await complete(providers, messages, SCHEMA)
    const summary = isObject(data) && typeof data.summary === 'string' ? data.summary.trim() : ''
    if (summary && summary.length <= MAX_SUMMARY && isGrounded(summary, facts)) return { summary, source: provider }
    console.warn(`LLM ${provider} summary rejected`)
  } catch {
    // complete() has logged why. The tables and the template still stand.
  }
  return template
}
