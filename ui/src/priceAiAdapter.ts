import type { ChatAdapter, ChatMessageChunk } from '@mui/x-chat/headless'
import { ApiRequestError, apiPost } from './api'
import { UNKNOWN_ERROR_MESSAGE } from './constants/apiErrors'
import { money } from './format'
import { businessHref, chargesHref } from './lenses'

type Split = { scenario: string; employer: number; employees: number }

type Outcome = {
  code: string | null
  description: string
  annual_volume: number
  status: 'recommended' | 'excluded'
  reason: string | null
  businesses: number
  rates: { median: number; low: number; high: number } | null
  variant: { modifiers: string[] } | null
  other_variants: number
  pick: {
    provider: string
    rate: number
    savings: number
    alternatives: { total: number }
  } | null
}

type Recommendation = {
  status: 'recommended' | 'coverage_not_met' | 'no_feasible_shortlist'
  constraints: { min_businesses_per_procedure: number; min_basket_coverage: number; max_preferred_providers: number; tie_tolerance: number }
  coverage: { qualifying: number; total: number; share: number }
  providers: { name: string; codes: string[]; annual_spend: number; needs_review: boolean }[]
  totals: {
    recommended_spend: number
    median_spend: number
    savings: number
    savings_percent: number
    savings_per_employee: number | null
    lowest_spend: number
    split: Split[]
  } | null
  procedures: Outcome[]
}

type Explanation = { summary: string; source: string }

const EXPLAIN_TIMEOUT_MS = 60_000 // the AI may take 40 s: its host, then the fallback

const SCENARIOS: Record<string, string> = {
  deductible_not_met: 'Deductible not yet met',
  deductible_met: 'Deductible met',
  out_of_pocket_met: 'Out-of-pocket maximum reached',
}

const REASONS: Record<string, string> = {
  no_code: 'no billing code given',
  not_found: 'code is not in the rate file',
  too_many_rates: 'too many rates to compare accurately',
  no_match: 'no rates for this place and modifiers',
}

const whole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const usd = (n: number) => whole.format(n)
const pct = (share: number) => `${Math.round(share * 1000) / 10}%`

/** Names come from the rate file or the user, so nothing in them may act as Markdown. */
const text = (s: string) => s.replace(/\s+/g, ' ').replace(/[\\`*_{}[\]<>()#|~!]/g, '\\$&')
const link = (label: string, hash: string) =>
  `[${text(label)}](/app/rates${hash.replace(/[()]/g, (c) => (c === '(' ? '%28' : '%29'))})`
const table = (head: string[], rows: string[][]) =>
  [head, head.map(() => '---'), ...rows].map((cells) => `| ${cells.join(' | ')} |`).join('\n')

function procedureLabel(p: Outcome) {
  return p.code ? `${text(p.description)} (${link(p.code, chargesHref(p.code))})` : text(p.description)
}

function thinData(r: Recommendation): string[] {
  const notes: string[] = []
  for (const p of r.procedures) {
    if (p.reason === 'too_few_businesses')
      notes.push(`**${procedureLabel(p)}: excluded.** ${p.businesses} businesses, and your minimum is ${r.constraints.min_businesses_per_procedure}.`)
    else if (p.reason && REASONS[p.reason]) notes.push(`**${procedureLabel(p)}: excluded,** ${REASONS[p.reason]}.`)
  }
  for (const p of r.procedures) {
    if (p.status === 'recommended' && p.other_variants > 0) {
      const used = p.variant?.modifiers.length ? `modifier ${text(p.variant.modifiers.join(', '))}` : 'no modifier'
      notes.push(`**${procedureLabel(p)}: variant assumed.** You gave no modifier, so it is priced with ${used}; ${p.other_variants} other variant${p.other_variants === 1 ? ' fits' : 's fit'}.`)
    }
  }
  for (const p of r.providers) if (p.needs_review) notes.push(`**${text(p.name)}:** this name looks like a placeholder. Check it before acting.`)
  notes.push('The rate file has no quality, location or capacity data. Savings assume each provider can take every visit, so treat them as a ceiling.')
  notes.push('Savings assume you pay the median business rate today.')
  return notes
}

/** The computed results as Markdown. Every figure comes from the API, none from a model. */
function render(r: Recommendation): string {
  const { coverage, constraints: c, totals: t } = r
  const parts = [
    `**Coverage:** ${coverage.qualifying} of ${coverage.total} procedures (${pct(coverage.share)}) have at least ${c.min_businesses_per_procedure} businesses. Your minimum is ${pct(c.min_basket_coverage)} of procedures.`,
  ]
  if (r.status === 'coverage_not_met') parts.push('**No recommendation:** coverage is below your minimum.')
  if (r.status === 'no_feasible_shortlist')
    parts.push(`**No recommendation:** ${c.max_preferred_providers} providers cannot cover every qualifying procedure.`)
  if (t) {
    const perEmployee = t.savings_per_employee === null ? '' : `, or ${money(t.savings_per_employee)} per employee`
    const extra = t.recommended_spend - t.lowest_spend
    parts.push(
      `**Savings:** up to **${usd(t.savings)} a year (${t.savings_percent}%)**${perEmployee}. Recommended spend is ${usd(t.recommended_spend)}, against ${usd(t.median_spend)} at the median.`,
      `### Recommended providers\n\n${table(
        ['Provider', 'Codes', 'Annual spend'],
        r.providers.map((p) => [link(p.name, businessHref(p.name)), text(p.codes.join(', ')), usd(p.annual_spend)]),
      )}`,
      extra >= 0.5
        ? `This is the fewest providers within ${pct(c.tie_tolerance)} of the lowest spend. It costs ${usd(extra)} (${pct(extra / t.lowest_spend)}) more than the cheapest shortlist.`
        : 'This is also the lowest spend possible within your provider limit.',
      `### By procedure\n\n${table(
        ['Procedure', 'Visits', 'Businesses', 'Low', 'Median', 'Provider', 'Rate', 'Annual savings', `Others within ${pct(c.tie_tolerance)} or cheaper`],
        r.procedures.flatMap((p) =>
          p.pick && p.rates
            ? [[
                procedureLabel(p), p.annual_volume.toLocaleString('en-US'), String(p.businesses), money(p.rates.low), money(p.rates.median),
                text(p.pick.provider), money(p.pick.rate), usd(p.pick.savings), String(p.pick.alternatives.total),
              ]]
            : [],
        ),
      )}`,
      `### Who keeps the savings\n\n${table(
        ['If every visit falls here in the member’s year', 'Employer', 'Employees'],
        t.split.map((s) => [SCENARIOS[s.scenario] ?? text(s.scenario), usd(s.employer), usd(s.employees)]),
      )}\n\nThe real split lies between these rows. Copays do not change with the provider’s rate, so savings on those visits go to the employer.`,
    )
  }
  parts.push(`### Where the data is thin\n\n${thinData(r).map((n) => `- ${n}`).join('\n')}`)
  return parts.join('\n\n')
}

const SOURCES: Record<string, string> = {
  ollama: 'AI summary (self-hosted model)',
  'workers-ai': 'AI summary (Workers AI)',
}

function renderExplanation({ summary, source }: Explanation): string {
  const label = SOURCES[source] ?? 'Summary (AI unavailable or its answer failed the number check)'
  return `\n\n### ${label}\n\n${text(summary)}`
}

function errorText(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return UNKNOWN_ERROR_MESSAGE
  return [error.message, ...error.details.map((d) => `- ${text(d)}`)].join('\n')
}

/** Shows the computed results as soon as they arrive, then adds the AI summary. */
async function respond(message: string, signal: AbortSignal, write: (markdown: string) => void) {
  let result: Recommendation
  try {
    result = await apiPost<Recommendation>('/api/price-ai/recommend', { message }, signal)
  } catch (error) {
    if (!signal.aborted) write(errorText(error))
    return
  }
  write(render(result))
  try {
    write(renderExplanation(await apiPost<Explanation>('/api/price-ai/explain', { message }, signal, EXPLAIN_TIMEOUT_MS)))
  } catch {
    if (!signal.aborted) write('\n\nThe AI summary could not be loaded. The results above are complete without it.')
  }
}

export const priceAiAdapter: ChatAdapter = {
  async sendMessage({ message, signal }) {
    const question = message.parts.map((part) => (part.type === 'text' ? part.text : '')).join('')
    const messageId = `reply-${crypto.randomUUID()}`
    const partId = `${messageId}-text`
    const controller = new AbortController()
    const abort = AbortSignal.any([signal, controller.signal])
    return new ReadableStream<ChatMessageChunk>({
      async start(out) {
        out.enqueue({ type: 'start', messageId })
        out.enqueue({ type: 'text-start', id: partId })
        await respond(question, abort, (delta) => {
          if (!abort.aborted) out.enqueue({ type: 'text-delta', id: partId, delta })
        })
        if (controller.signal.aborted) return // cancelled: the stream is already closed
        out.enqueue({ type: 'text-end', id: partId })
        out.enqueue({ type: 'finish', messageId, finishReason: 'stop' })
        out.close()
      },
      cancel: () => controller.abort(),
    })
  },
}
