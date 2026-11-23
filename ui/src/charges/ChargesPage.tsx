import { BarChart } from '@mantine/charts'
import { Button, Center, Container, Group, Loader, Pagination, Paper, SegmentedControl, Select, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core'
import { useMemo, useState } from 'react'
import CodeInput from '../CodeInput.tsx'
import { apiGetAll } from '../api.ts'
import { LinkTick, Stat, TooltipBox } from '../chartParts.tsx'
import { API_ERROR_MESSAGES } from '../constants/apiErrors.ts'
import { money, moneyShort, placeName, truncate, versusMedian } from '../format.ts'
import { NO_SERVICE, businessHref, chargesHref } from '../lenses.ts'
import { useApi } from '../useApi.ts'
import { byBusiness, histogram, niceStep, quantile, type Business, type ChargesResponse } from './stats.ts'

const PAGE_SIZE = 15
const NO_MODIFIER = '(none)'
const EXAMPLES = [
  { code: '99213', label: 'Office visit (99213)' },
  { code: '90837', label: 'Therapy, 60 min (90837)' },
  { code: '490', label: 'Surgery center (490)' },
]
const unique = (values: string[]) => [...new Set(values)].sort()

type Sort = 'low' | 'high'

const loadCharges = (code: string, signal: AbortSignal) => apiGetAll<ChargesResponse>('/api/charges', { code }, signal)

/** `rates` is ascending, one per business. */
function Distribution({ rates, median }: { rates: number[]; median: number }) {
  const bins = useMemo(() => histogram(rates, moneyShort), [rates])
  const medianBin = bins.find((b) => median < b.to) ?? bins[bins.length - 1]
  return (
    <Paper withBorder p="md" radius="sm">
      <Title order={3} size="h4">How prices are spread</Title>
      <Text size="sm" c="dimmed" mb="md">Number of businesses at each negotiated rate</Text>
      <BarChart
        h={280}
        data={bins}
        dataKey="label"
        series={[{ name: 'businesses', label: 'Businesses', color: 'blue.6' }]}
        tickLine="none"
        gridAxis="x"
        barChartProps={{ barCategoryGap: 2, margin: { top: 24 } }}
        xAxisProps={{ tickFormatter: (_, i) => (bins[i] ? moneyShort(bins[i].from) : ''), interval: 'preserveStartEnd', minTickGap: 16 }}
        yAxisProps={{ allowDecimals: false, width: 48 }}
        referenceLines={[{ x: medianBin.label, label: `Median ${money(median)}`, color: 'gray.6', labelPosition: 'top' }]}
        tooltipProps={{
          content: ({ payload }) => {
            const bin = payload?.[0]?.payload as (typeof bins)[number] | undefined
            return bin ? <TooltipBox title={bin.label} lines={[`${bin.businesses.toLocaleString()} of ${rates.length.toLocaleString()} businesses`]} /> : null
          },
        }}
      />
    </Paper>
  )
}

function Ranking({ businesses, median, highest }: { businesses: Business[]; median: number; highest: number }) {
  const [sort, setSort] = useState<Sort>('low')
  const [find, setFind] = useState('')
  const [page, setPage] = useState(1)

  const ordered = useMemo(
    () => [...businesses].sort((a, b) => (sort === 'low' ? a.rate - b.rate : b.rate - a.rate) || a.name.localeCompare(b.name)),
    [businesses, sort],
  )
  const term = find.trim().toLowerCase()
  const matches = useMemo(() => (term ? ordered.filter((b) => b.name.toLowerCase().includes(term)) : ordered), [ordered, term])
  const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE))
  const current = Math.min(page, pages)
  const shown = matches.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  // One scale for all pages, so bar lengths stay comparable while paging.
  const step = highest > 0 ? niceStep(highest, 5) : 1
  const ticks = Array.from({ length: Math.ceil(highest / step) + 1 }, (_, i) => i * step)

  return (
    <Paper withBorder p="md" radius="sm">
      <Group justify="space-between" align="flex-end" mb="md">
        <div>
          <Title order={3} size="h4">Negotiated rate by business</Title>
          <Text size="sm" c="dimmed">The line marks the median across all {businesses.length.toLocaleString()} businesses, {money(median)}. Select a name to see its other procedures</Text>
        </div>
        <Group gap="sm">
          <TextInput
            aria-label="Find a business"
            placeholder="Find a business"
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
            data={[{ value: 'low', label: 'Lowest first' }, { value: 'high', label: 'Highest first' }]}
          />
        </Group>
      </Group>
      {shown.length === 0 ? (
        <Center h={120}><Text c="dimmed">No business matches that name</Text></Center>
      ) : (
        <BarChart
          h={shown.length * 34 + 40}
          data={shown}
          dataKey="name"
          orientation="vertical"
          series={[{ name: 'rate', label: 'Negotiated rate', color: 'blue.6' }]}
          maxBarWidth={18}
          gridAxis="y"
          tickLine="none"
          withBarValueLabel
          valueLabelProps={{ position: 'right', formatter: (v: unknown) => money(Number(v)) }}
          barChartProps={{ margin: { right: 80 } }}
          xAxisProps={{ domain: [0, ticks[ticks.length - 1]], ticks, tickFormatter: moneyShort }}
          yAxisProps={{ width: 210, interval: 0, tick: (props) => <LinkTick {...props} find={(name) => ({ label: truncate(name, 27), title: `${name}: all procedures`, href: businessHref(name) })} /> }}
          referenceLines={[{ x: median, color: 'gray.6' }]}
          tooltipProps={{
            content: ({ payload }) => {
              const b = payload?.[0]?.payload as Business | undefined
              if (!b) return null
              const lines = [money(b.rate), versusMedian(b.rate, median)]
              if (b.rates > 1) lines.push(`Median of ${b.rates} rates, ${money(b.min)} to ${money(b.max)}`)
              if (b.eins > 1) lines.push(`Billed under ${b.eins} EINs`)
              return <TooltipBox title={b.name} lines={lines} />
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

function Charges({ response, initialService }: { response: ChargesResponse; initialService: string | null }) {
  const { item, data, services } = response

  // Rates for different services are never mixed: start on the linked one, else the best covered.
  const serviceOptions = useMemo(() => {
    const names = new Map(services.map((s) => [s.service, s.name]))
    const covered = new Map<string, Set<string>>()
    for (const c of data) {
      const key = c.service ?? NO_SERVICE
      covered.set(key, (covered.get(key) ?? new Set()).add(c.business_name ?? c.ein))
    }
    return [...covered].sort((a, b) => b[1].size - a[1].size).map(([value, set]) => ({
      value,
      label: `${value === NO_SERVICE ? 'Not itemized' : [value, names.get(value)].filter(Boolean).join(' - ')} (${set.size})`,
    }))
  }, [data, services])
  const [service, setService] = useState(() =>
    serviceOptions.find((o) => o.value === initialService)?.value ?? serviceOptions[0]?.value ?? NO_SERVICE)
  const [place, setPlace] = useState<string | null>(null)
  const [modifier, setModifier] = useState<string | null>(null)

  const inService = useMemo(() => data.filter((c) => (c.service ?? NO_SERVICE) === service), [data, service])
  const places = useMemo(() => unique(inService.flatMap((c) => c.service_code)), [inService])
  const modifiers = useMemo(
    () => unique(inService.flatMap((c) => (c.billing_code_modifier.length ? c.billing_code_modifier : [NO_MODIFIER]))),
    [inService],
  )
  const businesses = useMemo(
    () => byBusiness(inService.filter((c) =>
      (!place || c.service_code.includes(place)) &&
      (!modifier || (modifier === NO_MODIFIER ? c.billing_code_modifier.length === 0 : c.billing_code_modifier.includes(modifier))))),
    [inService, place, modifier],
  )
  const rates = useMemo(() => businesses.map((b) => b.rate).sort((a, b) => a - b), [businesses])
  const median = quantile(rates, 0.5)
  const serviceLabel = serviceOptions.find((o) => o.value === service)?.label
  const isRevenueCode = item.billing_code_type === 'RC'
  const mixed = (!place && places.length > 1) || (!modifier && modifiers.length > 1)

  return (
    <Stack gap="md">
      <div>
        <Title order={2} size="h3">
          {isRevenueCode ? `Revenue code ${item.billing_code}` : `${item.name ?? 'Procedure'} (${item.billing_code})`}
        </Title>
        <Text c="dimmed">
          {isRevenueCode
            ? `The file lists this price list under ${item.item_count.toLocaleString()} procedure name${item.item_count === 1 ? '' : 's'}. Each price belongs to the priced procedure below.`
            : item.description}
        </Text>
      </div>
      <Group align="flex-end" gap="sm">
        {(serviceOptions.length > 1 || service !== NO_SERVICE) && (
          <Select label="Priced procedure (businesses)" w={340} searchable allowDeselect={false} data={serviceOptions} value={service}
            onChange={(v) => {
              if (!v) return
              setService(v)
              setPlace(null)
              setModifier(null)
            }} />
        )}
        {places.length > 1 && (
          <Select label="Place of service" placeholder="Any" w={260} clearable value={place} onChange={setPlace}
            data={places.map((p) => ({ value: p, label: placeName(p) }))} />
        )}
        {modifiers.length > 1 && (
          <Select label="Modifier" placeholder="Any" w={130} clearable data={modifiers} value={modifier} onChange={setModifier} />
        )}
      </Group>
      {businesses.length === 0 ? (
        <Center h={200}><Text c="dimmed">No rates match these filters</Text></Center>
      ) : (
        <>
          <SimpleGrid cols={{ base: 2, md: 4 }}>
            <Stat label="Median" value={money(median)} hint={isRevenueCode ? serviceLabel : undefined} />
            <Stat label="Middle half of businesses" value={`${money(quantile(rates, 0.25))} to ${money(quantile(rates, 0.75))}`} />
            <Stat label="Lowest to highest" value={`${money(rates[0])} to ${money(rates[rates.length - 1])}`}
              hint={rates[0] > 0 && rates.length > 1 ? `${(rates[rates.length - 1] / rates[0]).toFixed(1)} times apart` : undefined} />
            <Stat label="Businesses" value={rates.length.toLocaleString()} />
          </SimpleGrid>
          <Text size="sm" c="dimmed">
            {mixed ? 'These rates mix places of service or modifiers. Choose one above to compare like with like. ' : ''}
            Rates are what the insurer agreed to pay, not your out-of-pocket cost. A business with several rates is shown at its median.
          </Text>
          <Distribution rates={rates} median={median} />
          <Ranking key={`${service}|${place}|${modifier}`} businesses={businesses} median={median} highest={rates[rates.length - 1]} />
        </>
      )}
    </Stack>
  )
}

export default function ChargesPage({ code, service }: { code: string; service: string | null }) {
  const [draft, setDraft] = useState(code)
  const [error, setError] = useState<string>()
  const { data, loading, retry } = useApi('charges', code, loadCharges)
  const [seenCode, setSeenCode] = useState(code)
  if (seenCode !== code) {
    setSeenCode(code)
    setDraft(code)
  }

  function open(next: string) {
    const clean = next.trim().toUpperCase()
    const problem = !clean ? API_ERROR_MESSAGES.MISSING_CODE : !/^[A-Z0-9]{1,20}$/.test(clean) ? API_ERROR_MESSAGES.INVALID_CODE : undefined
    setError(problem)
    if (!problem) window.location.hash = chargesHref(clean)
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
            <CodeInput value={draft} onChange={setDraft} onPick={open} error={error} />
            <Button type="submit" mt={25}>Compare</Button>
          </Group>
        </form>
        {!code ? (
          <Stack align="center" py="xl">
            <Text c="dimmed">Choose a procedure to see what each business is paid for it</Text>
            <Group gap="xs" justify="center">
              {EXAMPLES.map((e) => <Button key={e.code} component="a" href={chargesHref(e.code)} variant="light">{e.label}</Button>)}
            </Group>
          </Stack>
        ) : loading ? (
          <Center h={300}><Loader aria-label="Loading rates" /></Center>
        ) : !data ? (
          <Stack align="center" py="xl">
            <Text c="dimmed">The rates for {code} could not be loaded</Text>
            <Button variant="light" onClick={retry}>Try again</Button>
          </Stack>
        ) : (
          <Charges key={`${code}|${service}`} response={data} initialService={service} />
        )}
      </Stack>
    </Container>
  )
}
