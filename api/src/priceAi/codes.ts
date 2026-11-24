import { all } from '../routes'

/** A billing code the user can pick for a procedure they named in words. */
export type CodeMatch = { code: string; type: string | null; name: string | null; description: string | null }

export const MAX_MATCHES = 10
const MAX_TERMS = 12
const MIN_SHARE = 0.6 // of the best score; drops codes that match only part of the request

const LOWER_JOINT = ['joint of lower extremity', 'jnt of lwr', 'joint of lwr']
const UPPER_JOINT = ['joint of upper extremity', 'joint upr extrem']

/** Everyday words to the wording the rate file uses. A knee MRI, for one, is "MRI JNT OF LWR EXTRE". */
const SYNONYMS: Record<string, string[]> = {
  knee: LOWER_JOINT,
  ankle: LOWER_JOINT,
  hip: LOWER_JOINT,
  shoulder: UPPER_JOINT,
  elbow: UPPER_JOINT,
  wrist: UPPER_JOINT,
  contrast: ['dye'],
  ct: ['computed tomography'],
  ecg: ['electrocardiogram'],
  ekg: ['electrocardiogram', 'ecg'],
  mammogram: ['mammo', 'mammography'],
  therapy: ['therapeutic'],
  ultrasound: ['us'],
  xray: ['x ray'],
}

/** Lower-case words separated and surrounded by single spaces. */
const normalise = (s: string) =>
  ` ${s.toLowerCase().replace(/\bw\/o\b|\bwithout\b/g, ' without ').replace(/\bw\//g, ' with ').replace(/[^a-z0-9]+/g, ' ').trim()} `

/** Whole words for short terms and "with" (a prefix of "without"); word prefixes otherwise. */
const pattern = (term: string) => (term.length < 4 || term === 'with' ? ` ${term} ` : ` ${term}`)

const patternsFor = (term: string): string[] => {
  const singular = term.length > 3 && term.endsWith('s') ? [term.slice(0, -1)] : []
  return [term, ...singular].flatMap((t) => [t, ...(Object.hasOwn(SYNONYMS, t) ? SYNONYMS[t] : [])]).map(pattern)
}

/**
 * Every code that analyzePlan could price. Revenue codes (RC) are left out: one of them covers many
 * unrelated services, so picking it would price the wrong thing.
 */
export async function loadCodes(db: D1Database): Promise<CodeMatch[]> {
  const rows = await all(
    db,
    `SELECT b.billing_code AS code, b.billing_code_type AS type, b.name, b.description
       FROM billing_items b
      WHERE b.billing_code_type IS NOT 'RC'
        AND b.item_id = (SELECT MIN(c.item_id) FROM billing_items c WHERE c.billing_code = b.billing_code)
        AND EXISTS (SELECT 1 FROM negotiated_prices p WHERE p.item_id = b.item_id
                     AND p.negotiated_rate IS NOT NULL AND p.negotiated_type IS NOT 'percentage')
      ORDER BY b.billing_code`,
  )
  return rows as CodeMatch[]
}

/** Best matches first. Rarer words count for more, so "of" or "with" cannot outweigh "knee". */
export function matchCodes(codes: CodeMatch[], query: string): CodeMatch[] {
  const terms = [...new Set(normalise(query).split(' ').filter(Boolean))].slice(0, MAX_TERMS)
  const docs = codes.map((c) => ({
    code: c,
    name: normalise(`${c.code} ${c.name ?? ''}`),
    description: normalise(c.description ?? ''),
    score: 0,
  }))
  for (const term of terms) {
    const patterns = patternsFor(term)
    const hits = docs
      .map((doc) => ({
        doc,
        weight: patterns.some((p) => doc.name.includes(p)) ? 1 : patterns.some((p) => doc.description.includes(p)) ? 0.8 : 0,
      }))
      .filter((h) => h.weight > 0)
    for (const { doc, weight } of hits) doc.score += weight * Math.log(1 + docs.length / hits.length)
  }
  // Array.sort is stable and codes arrive in code order, so ties are deterministic.
  const ranked = docs.filter((d) => d.score > 0).sort((a, b) => b.score - a.score)
  return ranked
    .filter((d) => d.score >= ranked[0].score * MIN_SHARE)
    .slice(0, MAX_MATCHES)
    .map((d) => d.code)
}
