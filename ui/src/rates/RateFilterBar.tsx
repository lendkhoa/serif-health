import { Autocomplete, Button, Group, Select, TextInput } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { useEffect, useState, type FormEvent } from 'react'
import { apiGet } from '../api.ts'
import { API_ERROR_MESSAGES } from '../constants/apiErrors.ts'
import { EMPTY_FILTERS, type RateFilters } from './types.ts'

type Suggestions = { codes: { code: string; name: string | null }[] }
type Errors = { code?: string; npi?: string; ein?: string }

// Same rules as the API, checked here so bad input never costs a request.
function validate(f: RateFilters): Errors {
  const errors: Errors = {}
  const narrowed = f.npi || f.ein || f.setting || f.billingClass
  if (!f.code && narrowed) errors.code = 'Add a billing code to use these filters.'
  else if (f.code && !/^[A-Za-z0-9]{1,20}$/.test(f.code)) errors.code = API_ERROR_MESSAGES.INVALID_CODE
  if (f.npi && !/^\d{10}$/.test(f.npi)) errors.npi = API_ERROR_MESSAGES.INVALID_NPI
  if (f.ein && !/^\d{9}$/.test(f.ein.replace(/-/g, ''))) errors.ein = API_ERROR_MESSAGES.INVALID_EIN
  return errors
}

/** Filters apply on submit, not per keystroke, so typing never triggers a search. */
export default function RateFilterBar({ applied, onApply }: { applied: RateFilters; onApply: (f: RateFilters) => void }) {
  const [draft, setDraft] = useState(applied)
  const [errors, setErrors] = useState<Errors>({})
  const [options, setOptions] = useState<{ value: string; label: string }[]>([])
  const [term] = useDebouncedValue(draft.code.trim(), 300)

  useEffect(() => {
    if (term.length < 2) return
    const controller = new AbortController()
    apiGet<Suggestions>('/api/suggest', { q: term }, controller.signal)
      .then((s) => setOptions(s.codes.map((c) => ({ value: c.code, label: c.code + (c.name ? ` - ${c.name}` : '') }))))
      .catch(() => {}) // suggestions are optional; the search itself reports errors
    return () => controller.abort()
  }, [term])

  const set = <K extends keyof RateFilters>(key: K, value: RateFilters[K]) => {
    setDraft((d) => ({ ...d, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const clean = { ...draft, code: draft.code.trim().toUpperCase(), npi: draft.npi.trim(), ein: draft.ein.trim() }
    const found = validate(clean)
    setErrors(found)
    if (Object.values(found).some(Boolean)) return
    setDraft(clean)
    onApply(clean)
  }

  return (
    <form onSubmit={submit} noValidate>
      <Group align="flex-start" gap="sm">
        <Autocomplete
          label="Billing code"
          placeholder="e.g. 99213"
          w={200}
          value={draft.code}
          onChange={(v) => set('code', v)}
          data={options.map((o) => o.value)}
          renderOption={({ option }) => options.find((o) => o.value === option.value)?.label ?? option.value}
          comboboxProps={{ width: 340, position: 'bottom-start' }}
          filter={({ options: all }) => all}
          error={errors.code}
        />
        <TextInput label="NPI" placeholder="10 digits" w={150} inputMode="numeric" value={draft.npi} onChange={(e) => set('npi', e.currentTarget.value)} error={errors.npi} />
        <TextInput label="EIN" placeholder="12-3456789" w={150} value={draft.ein} onChange={(e) => set('ein', e.currentTarget.value)} error={errors.ein} />
        <Select label="Setting" placeholder="Any" w={140} clearable data={['inpatient', 'outpatient', 'both']} value={draft.setting} onChange={(v) => set('setting', v)} />
        <Select label="Billing class" placeholder="Any" w={150} clearable data={['professional', 'institutional', 'both']} value={draft.billingClass} onChange={(v) => set('billingClass', v)} />
        <Group gap="xs" mt={25}>
          <Button type="submit">Search</Button>
          <Button
            variant="default"
            onClick={() => {
              setDraft(EMPTY_FILTERS)
              setErrors({})
              onApply(EMPTY_FILTERS)
            }}
          >
            Clear
          </Button>
        </Group>
      </Group>
    </form>
  )
}
