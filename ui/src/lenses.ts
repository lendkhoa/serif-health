import { useHash } from '@mantine/hooks'

/** Each lens is one way of looking at the same rates. To add one: list it here and render it in App. */
export const LENSES = [
  { id: 'rates', label: 'All rates' },
  { id: 'charges', label: 'Compare businesses' },
  { id: 'business', label: 'One business' },
] as const

export type LensId = (typeof LENSES)[number]['id']

export function lensHref(id: LensId, params: Record<string, string | null | undefined> = {}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value)
  return `#/${id}${query.size ? `?${query}` : ''}`
}

/** `service` value for prices with no priced service, which must not open on some other service. */
export const NO_SERVICE = '(none)'

/** Leave `service` out to open on the best-covered one; null means "not itemized". */
export const chargesHref = (code: string, service?: string | null) =>
  lensHref('charges', { code, service: service === null ? NO_SERVICE : service })

export const businessHref = (name: string) => lensHref('business', { name })

/** The current lens and its parameters, read from the URL hash so views can be linked and bookmarked. */
export function useLens(): { lens: LensId; params: URLSearchParams } {
  const [hash] = useHash({ getInitialValueInEffect: false })
  const [path, query] = hash.replace(/^#?\/?/, '').split('?')
  return { lens: LENSES.find((l) => l.id === path)?.id ?? 'rates', params: new URLSearchParams(query) }
}
