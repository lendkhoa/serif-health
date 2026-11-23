import { BarChart } from '@mantine/charts'
import { Autocomplete, Button, Center, Container, Group, Loader, Pagination, Paper, SegmentedControl, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { useEffect, useMemo, useState } from 'react'
import { apiGet, apiGetAll } from '../api.ts'
import { LinkTick, Stat, TooltipBox } from '../chartParts.tsx'
import { API_ERROR_MESSAGES } from '../constants/apiErrors.ts'
import { money, percentVs, placeName, truncate, versusMedian } from '../format.ts'
import { businessHref, chargesHref } from '../lenses.ts'
import { quantile } from '../charges/stats.ts'
import { useApi } from '../useApi.ts'

const PAGE_SIZE = 15
const MIN_BUSINESSES = 5 // fewer than this and a "median" says little
const MAX_PCT = 200 // longer bars are cut here so one outlier doesn't flatten the rest
const EXAMPLES = ['Beacon IPA LLC', 'Northwell Health Laboratories', 'Laboratory Corporation of America Holdings']

type Procedure = {
  code: string
  type: string | null
  name: string | null
  service: string | null
  service_name: string | null
  place: string[]
  modifier: string[]
  billing_class: string
  rate: number
  median: number
  low: number
  high: number
  businesses: number
}
type BusinessResponse = { name: string; ein_count: number; next_cursor: string | null; data: Procedure[] }
type Sort = 'above' | 'below' | 'common'
type Row = Procedure & { id: string; title: string; variant: string; pct: number; bar: number }

const loadBusiness = (name: string, signal: AbortSignal) => apiGetAll<BusinessResponse>('/api/business', { name }, signal)

const signed = (pct: number) => (pct === 0 ? '0%' : `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`)

function toRow(p: Procedure, index: number): Row {
  // For revenue codes the priced service is the procedure; the item's own name is only a label.
  const title = p.service
    ? `${p.service}${p.service_name ? ` ${p.service_name}` : ''}${p.service === p.code ? '' : ` (${p.type === 'RC' ? 'revenue code ' : ''}${p.code})`}`
    : p.type === 'RC'
      ? `Revenue code ${p.code}, not itemized`
      : `${p.code}${p.name ? ` ${p.name}` : ''}`
  const variant = [...p.place.map(placeName), ...p.modifier.map((m) => `modifier ${m}`), p.billing_class].filter(Boolean).join(', ')
  const pct = percentVs(p.rate, p.median)
  return { ...p, id: String(index), title, variant, pct, bar: Math.min(pct, MAX_PCT) }
}

function Procedures({ rows }: { rows: Row[] }) {
  const [sort, setSort] = useState<Sort>('above')
  const [find, setFind] = useState('')
  const [page, setPage] = useState(1)

  const ordered = useMemo(
    () => [...rows].sort((a, b) => (sort === 'above' ? b.pct - a.pct : sort === 'below' ? a.pct - b.pct : 0) || b.businesses - a.businesses),
    [rows, sort],
  )
  const term = find.trim().toLowerCase()
  const matches = useMemo(() => (term ? ordered.filter((r) => `${r.title} ${r.variant}`.toLowerCase().includes(term)) : ordered), [ordered, term])
  const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE))
  const current = Math.min(page, pages)
  const shown = matches.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  // Symmetric and shared by all pages, so left/right and bar lengths stay comparable.
  const limit = useMemo(() => Math.max(50, Math.ceil(Math.max(...rows.map((r) => Math.abs(r.bar))) / 50) * 50), [rows])
  const byId = new Map(shown.map((r) => [r.id, r]))

  return (
    <Paper withBorder p="md" radius="sm">
      <Group justify="space-between" align="flex-end" mb="md">
        <div>
          <Title order={3} size="h4">Difference from the median business</Title>
          <Text size="sm" c="dimmed">
            Left of the line is cheaper than most, right is more expensive. Select a procedure to compare every business
          </Text>
        </div>
        <Group gap="sm">
          <TextInput
            aria-label="Find a procedure"
            placeholder="Find a procedure"
            value={find}
            onChange={(e) => {
              setFind(e.currentTarget.value)
              setPage(1)
            }}
          />
          <SegmentedControl
            aria-label="Order"
            value={sort}
            onChange={(v) => {
              setSort(v as Sort)
              setPage(1)
            }}
            data={[
              { value: 'above', label: 'Furthest above' },
              { value: 'below', label: 'Furthest below' },
              { value: 'common', label: 'Most compared' },
            ]}
          />
        </Group>
      </Group>
      {shown.length === 0 ? (
        <Center h={120}><Text c="dimmed">No procedure matches that search</Text></Center>
      ) : (
        <BarChart
          h={shown.length * 34 + 40}
          data={shown}
          dataKey="id"
          orientation="vertical"
          series={[{ name: 'bar', label: 'Difference', color: 'blue.6' }]}
          getBarColor={(value) => (value > 0 ? 'orange.6' : 'blue.6')}
          maxBarWidth={18}
          gridAxis="y"
          tickLine="none"
          withBarValueLabel
          valueLabelProps={{ position: 'right', dataKey: 'pct', formatter: (v: unknown) => signed(Number(v)) }}
          barChartProps={{ margin: { left: 8, right: 56 } }}
          xAxisProps={{ domain: [-limit, limit], ticks: [-limit, -limit / 2, 0, limit / 2, limit], tickFormatter: (n: number) => signed(Math.round(n)) }}
          yAxisProps={{
            width: 260,
            interval: 0,
            tick: (props) => (
              <LinkTick
                {...props}
                find={(id) => {
                  const r = byId.get(id)
                  return r && { label: truncate(r.title, 36), title: `${r.title}, ${r.variant}: compare businesses`, href: chargesHref(r.code, r.service) }
                }}
              />
            ),
          }}
          referenceLines={[{ x: 0, color: 'gray.6' }]}
          tooltipProps={{
            content: ({ payload }) => {
              const r = payload?.[0]?.payload as Row | undefined
              if (!r) return null
              const lines = [
                r.variant,
                `${money(r.rate)} here, ${money(r.median)} at the median business`,
                versusMedian(r.rate, r.median),
                `${r.businesses.toLocaleString()} businesses, ${money(r.low)} to ${money(r.high)}`,
              ]
              return <TooltipBox title={r.title} lines={lines.filter(Boolean)} />
            },
          }}
        />
      )}
      {pages > 1 && (
        <Group justify="center" mt="md">
          <Pagination total={pages} value={current} onChange={setPage} />
        </Group>
      )}
    </Paper>
  )
}

function Profile({ response }: { response: BusinessResponse }) {
  const all = useMemo(() => response.data.map(toRow), [response])
  const rows = useMemo(() => all.filter((r) => r.businesses >= MIN_BUSINESSES), [all])
  const excluded = all.length - rows.length
  const { typical, below, at, above } = useMemo(() => {
    const sorted = rows.map((r) => r.pct).sort((a, b) => a - b)
    return {
      typical: sorted.length ? Math.round(quantile(sorted, 0.5)) : 0,
      below: sorted.filter((p) => p < 0).length.toLocaleString(),
      at: sorted.filter((p) => p === 0).length.toLocaleString(),
      above: sorted.filter((p) => p > 0).length.toLocaleString(),
    }
  }, [rows])

  return (
    <Stack gap="md">
      <div>
        <Title order={2} size="h3">{response.name}</Title>
        <Text c="dimmed">
          {response.ein_count > 1 ? `Bills under ${response.ein_count} EINs, so its rates cover several practices. ` : ''}
          {excluded > 0
            ? `${excluded.toLocaleString()} of its ${all.length.toLocaleString()} priced procedures are left out because fewer than ${MIN_BUSINESSES} businesses have them.`
            : ''}
        </Text>
      </div>
      {rows.length === 0 ? (
        <Center h={200}><Text c="dimmed">None of its procedures are priced by {MIN_BUSINESSES} or more businesses</Text></Center>
      ) : (
        <>
          <SimpleGrid cols={{ base: 2, md: 4 }}>
            <Stat label="Typical difference" value={signed(typical)} hint="Median across its procedures" />
            <Stat label="Below the median" value={below} hint="procedures" />
            <Stat label="At the median" value={at} hint="procedures, within half a percent" />
            <Stat label="Above the median" value={above} hint="procedures" />
          </SimpleGrid>
          <Text size="sm" c="dimmed">
            Each procedure is compared only with the same place of service, modifier and billing class. Rates are what the insurer agreed to pay, not your
            out-of-pocket cost.{rows.some((r) => r.pct > MAX_PCT) ? ` Bars stop at +${MAX_PCT}%; the labels show the full difference.` : ''}
          </Text>
          <Procedures rows={rows} />
        </>
      )}
    </Stack>
  )
}

function BusinessInput({ value, onChange, onPick, error }: { value: string; onChange: (v: string) => void; onPick: (v: string) => void; error?: string }) {
  const [options, setOptions] = useState<string[]>([])
  const [edited, setEdited] = useState(false)
  const [term] = useDebouncedValue(value.trim(), 300)

  useEffect(() => {
    if (!edited || term.length < 2) return
    const controller = new AbortController()
    apiGet<{ organisations: { business_name: string | null }[] }>('/api/suggest', { q: term }, controller.signal)
      .then((s) => setOptions([...new Set(s.organisations.flatMap((o) => o.business_name ?? []))]))
      .catch(() => {}) // suggestions are optional; the lookup itself reports errors
    return () => controller.abort()
  }, [term, edited])

  return (
    <Autocomplete
      label="Business name"
      placeholder="e.g. Northwell"
      w={340}
      value={value}
      onChange={(v) => {
        setEdited(true)
        onChange(v)
      }}
      onOptionSubmit={onPick}
      data={options}
      filter={({ options: all }) => all}
      error={error}
    />
  )
}

export default function BusinessPage({ name }: { name: string }) {
  const { data, loading, retry } = useApi('business', name, loadBusiness)
  const [draft, setDraft] = useState(name)
  const [error, setError] = useState<string>()

  const [seenName, setSeenName] = useState(name)
  if (seenName !== name) {
    setSeenName(name)
    setDraft(name)
  }

  function open(next: string) {
    const clean = next.trim()
    const problem = !clean || clean.length > 200 ? API_ERROR_MESSAGES.MISSING_NAME : undefined
    setError(problem)
    if (!problem) window.location.hash = businessHref(clean)
  }

  return (
    <Container fluid px={{ base: 'sm', sm: 'md' }} py="md">
      <Stack gap="lg">
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            open(draft)
          }}
        >
          <Group align="flex-start" gap="sm">
            <BusinessInput value={draft} onChange={setDraft} onPick={open} error={error} />
            <Button type="submit" mt={25}>Show</Button>
          </Group>
        </form>
        {!name ? (
          <Stack align="center" py="xl">
            <Text c="dimmed">Choose a business to see which of its procedures cost more or less than elsewhere</Text>
            <Group gap="xs" justify="center">
              {EXAMPLES.map((e) => <Button key={e} component="a" href={businessHref(e)} variant="light">{e}</Button>)}
            </Group>
          </Stack>
        ) : loading ? (
          <Center h={300}><Loader aria-label="Loading procedures" /></Center>
        ) : !data ? (
          <Stack align="center" py="xl">
            <Text c="dimmed">No procedures could be loaded for {name}</Text>
            <Button variant="light" onClick={retry}>Try again</Button>
          </Stack>
        ) : (
          <Profile key={name} response={data} />
        )}
      </Stack>
    </Container>
  )
}
