const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const usdShort = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2, trailingZeroDisplay: 'stripIfInteger' })

export const money = (n: number) => usd.format(n)
export const moneyShort = (n: number) => usdShort.format(n)
export const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/** Whole-percent difference from the median; 0 when the median is 0. */
export const percentVs = (rate: number, median: number) => (median > 0 ? Math.round((rate / median - 1) * 100) : 0)

export function versusMedian(rate: number, median: number) {
  const pct = percentVs(rate, median)
  return pct === 0 ? 'At the median' : `${Math.abs(pct)}% ${pct < 0 ? 'below' : 'above'} the median`
}

/** CMS place-of-service codes. */
export const PLACES: Record<string, string> = {
  '02': 'Telehealth, not at home', '10': 'Telehealth, at home', '11': 'Office', '12': 'Home', '19': 'Off-campus outpatient hospital',
  '20': 'Urgent care', '21': 'Inpatient hospital', '22': 'On-campus outpatient hospital', '23': 'Emergency room',
  '24': 'Ambulatory surgery center', '49': 'Independent clinic', '50': 'Federally qualified health center', '81': 'Independent lab',
}

export const placeName = (code: string) => (PLACES[code] ? `${PLACES[code]} (${code})` : code)
