import type { Procedure } from './schema'

/** One row of charges(): a dollar rate for one business. */
export type Charge = {
  business_name: string | null
  ein: string
  negotiated_rate: number
  billing_class: string | null
  service: string | null
  service_code: string[]
  billing_code_modifier: string[]
}

export type Variant = { billing_class: string | null; service: string | null; place: string[]; modifiers: string[] }

/** `rate` is the median of the business's rates for the variant, as on the Compare businesses page. */
export type RankedBusiness = { name: string; eins: string[]; rate: number; min: number; max: number }

export type Ranking = {
  variant: Variant
  /** True when several variants fit the request and the best-covered one was picked. */
  assumed: boolean
  other_variants: number
  businesses: RankedBusiness[] // cheapest first
}

/** These price only part of a procedure (26 professional, TC technical), so ranking them would understate it. */
const PARTIAL_MODIFIERS = ['26', 'TC']

const medianOf = (sorted: number[]) => (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

function fits(charge: Charge, want: Pick<Procedure, 'modifiers' | 'place'>): boolean {
  const has = charge.billing_code_modifier
  if (want.place && !charge.service_code.includes(want.place)) return false
  if (!want.modifiers.every((m) => has.includes(m))) return false
  return !PARTIAL_MODIFIERS.some((m) => has.includes(m) && !want.modifiers.includes(m))
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((v) => b.includes(v))

/** The request names this variant's place and modifiers exactly, with nothing left over. */
const isExact = (variant: Variant, want: Pick<Procedure, 'modifiers' | 'place'>) =>
  want.place !== null && same(variant.place, [want.place]) && same(variant.modifiers, want.modifiers)

/** Ranks businesses within a single exact variant, so unlike services are never compared. Null = nothing fits. */
export function rankBusinesses(charges: Charge[], want: Pick<Procedure, 'modifiers' | 'place'>): Ranking | null {
  type Group = { variant: Variant; businesses: Map<string, { name: string; eins: Set<string>; rates: Set<number> }> }
  const groups = new Map<string, Group>()
  for (const c of charges) {
    if (!fits(c, want)) continue
    const variant: Variant = {
      billing_class: c.billing_class,
      service: c.service,
      place: [...c.service_code].sort(),
      modifiers: [...c.billing_code_modifier].sort(),
    }
    const key = JSON.stringify(variant)
    const group = groups.get(key) ?? { variant, businesses: new Map() }
    groups.set(key, group)
    const name = c.business_name?.trim() || `EIN ${c.ein}`
    const business = group.businesses.get(name.toLowerCase()) ?? { name, eins: new Set(), rates: new Set() }
    group.businesses.set(name.toLowerCase(), business)
    business.eins.add(c.ein)
    business.rates.add(c.negotiated_rate)
  }
  if (groups.size === 0) return null

  const exact = [...groups].filter(([, g]) => isExact(g.variant, want))
  const candidates = exact.length ? exact : [...groups]
  // Fewest unrequested modifiers breaks ties, then the key, so the choice never depends on row order.
  const [[, best]] = candidates.sort(
    ([ka, a], [kb, b]) =>
      b.businesses.size - a.businesses.size || a.variant.modifiers.length - b.variant.modifiers.length || byName(ka, kb),
  )
  return {
    variant: best.variant,
    assumed: candidates.length > 1,
    other_variants: candidates.length - 1,
    businesses: [...best.businesses.values()]
      .map(({ name, eins, rates }) => {
        const sorted = [...rates].sort((a, b) => a - b)
        return { name, eins: [...eins].sort(), rate: medianOf(sorted), min: sorted[0], max: sorted[sorted.length - 1] }
      })
      .sort((a, b) => a.rate - b.rate || byName(a.name, b.name)),
  }
}
