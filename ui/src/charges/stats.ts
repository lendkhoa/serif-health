export type Charge = {
  business_name: string | null
  ein: string
  negotiated_rate: number
  billing_class: string | null
  service_code: string[]
  billing_code_modifier: string[]
  service: string | null
}

export type ChargesResponse = {
  item: { billing_code: string; billing_code_type: string | null; name: string | null; description: string | null; item_count: number }
  services: { service: string; name: string | null }[]
  next_cursor: string | null
  data: Charge[]
}

/** One business: `rate` is the median of its rates, so every business counts once. */
export type Business = { name: string; rate: number; min: number; max: number; rates: number; eins: number }

/** Linear-interpolated quantile of an ascending list. */
export function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q
  const low = Math.floor(pos)
  return sorted[low] + ((sorted[low + 1] ?? sorted[low]) - sorted[low]) * (pos - low)
}

export function byBusiness(charges: Charge[]): Business[] {
  const groups = new Map<string, { name: string; rates: Set<number>; eins: Set<string> }>()
  for (const c of charges) {
    const name = c.business_name?.trim() || `EIN ${c.ein}`
    const key = name.toLowerCase()
    const g = groups.get(key) ?? { name, rates: new Set<number>(), eins: new Set<string>() }
    g.rates.add(c.negotiated_rate)
    g.eins.add(c.ein)
    groups.set(key, g)
  }
  return [...groups.values()].map((g) => {
    const rates = [...g.rates].sort((a, b) => a - b)
    return { name: g.name, rate: quantile(rates, 0.5), min: rates[0], max: rates[rates.length - 1], rates: rates.length, eins: g.eins.size }
  })
}

export type Bin = { from: number; to: number; label: string; businesses: number }

/** Round step (1, 2, 2.5, 5 x 10^n) giving about `target` bins over `span`. */
export function niceStep(span: number, target: number): number {
  const raw = span / target
  const base = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 2.5, 5, 10].map((m) => m * base).find((s) => s >= raw)!
}

/** Equal-width bins. The top 1% is folded into a final open-ended bin so outliers don't flatten the rest. */
export function histogram(sorted: number[], format: (n: number) => string, target = 18): Bin[] {
  if (!sorted.length) return []
  const min = sorted[0]
  const max = sorted[sorted.length - 1]
  if (min === max) return [{ from: min, to: max, label: format(min), businesses: sorted.length }]
  const p99 = quantile(sorted, 0.99)
  const top = p99 > min && max > min + (p99 - min) * 1.25 ? p99 : max
  const step = niceStep(top - min, target)
  const start = Math.floor(min / step)
  const count = Math.max(1, Math.floor(top / step) - start + 1)
  const bins: Bin[] = Array.from({ length: count }, (_, i) => {
    const from = (start + i) * step
    return { from, to: from + step, label: `${format(from)} to ${format(from + step)}`, businesses: 0 }
  })
  const end = bins[count - 1].to
  if (max >= end) bins.push({ from: end, to: Infinity, label: `${format(end)} or more`, businesses: 0 })
  for (const v of sorted) bins[Math.min(bins.length - 1, Math.max(0, Math.floor(v / step) - start))].businesses++
  return bins
}
