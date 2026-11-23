import { Autocomplete } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { useEffect, useState } from 'react'
import { apiGet } from './api.ts'

type Suggestions = { codes: { code: string; name: string | null }[] }
type Props = { value: string; onChange: (value: string) => void; onPick?: (value: string) => void; error?: string }

/** Billing-code field with debounced suggestions from /api/suggest. */
export default function CodeInput({ value, onChange, onPick, error }: Props) {
  const [options, setOptions] = useState<{ value: string; label: string }[]>([])
  const [edited, setEdited] = useState(false)
  const [term] = useDebouncedValue(value.trim(), 300)

  useEffect(() => {
    if (!edited || term.length < 2) return
    const controller = new AbortController()
    apiGet<Suggestions>('/api/suggest', { q: term }, controller.signal)
      .then((s) => setOptions(s.codes.map((c) => ({ value: c.code, label: c.code + (c.name ? ` - ${c.name}` : '') }))))
      .catch(() => {}) // suggestions are optional; the search itself reports errors
    return () => controller.abort()
  }, [term, edited])

  return (
    <Autocomplete
      label="Billing code"
      placeholder="e.g. 99213"
      w={200}
      value={value}
      onChange={(v) => {
        setEdited(true)
        onChange(v)
      }}
      onOptionSubmit={onPick}
      data={options.map((o) => o.value)}
      renderOption={({ option }) => options.find((o) => o.value === option.value)?.label ?? option.value}
      comboboxProps={{ width: 340, position: 'bottom-start' }}
      filter={({ options: all }) => all}
      error={error}
    />
  )
}
