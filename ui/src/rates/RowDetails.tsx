import { Badge, Button, Group, Stack, Text } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import { businessHref, chargesHref } from '../lenses.ts'
import { apiGet, notifyApiError } from '../api.ts'
import type { Page, RateRow } from './types.ts'

const NPI_PAGE = 200

/** Full text plus NPIs for one row. NPIs beyond the preview load only on request, a page at a time. */
export default function RowDetails({ row }: { row: RateRow }) {
  const [npis, setNpis] = useState<number[]>(row.npis)
  const [cursor, setCursor] = useState<string | null>(null)
  const [started, setStarted] = useState(false)
  const [loading, setLoading] = useState(false)
  const controller = useRef<AbortController | null>(null)

  useEffect(() => () => controller.current?.abort(), [])

  const lookupPossible = /^\d{9}$/.test(row.ein.replace(/-/g, '')) && row.provider_group_ids.length > 0
  const hasMore = started ? cursor !== null : npis.length < row.npi_count && lookupPossible

  async function loadMore() {
    const abort = new AbortController()
    controller.current = abort
    setLoading(true)
    try {
      const res = await apiGet<Page<{ npi: number }>>(
        '/api/providers',
        { ein: row.ein, groups: row.provider_group_ids.join(','), limit: NPI_PAGE, cursor },
        abort.signal,
      )
      setNpis((prev) => [...new Set([...prev, ...res.data.map((d) => d.npi)])])
      setCursor(res.next_cursor)
      setStarted(true)
    } catch (error) {
      if (!abort.signal.aborted) notifyApiError(error)
    } finally {
      if (!abort.signal.aborted) setLoading(false)
    }
  }

  return (
    <Stack gap="xs" p="md" maw="min(1100px, 92vw)" style={{ position: 'sticky', left: 0 }}>
      <Button component="a" href={chargesHref(row.billing_code, row.additional_information)} size="xs" variant="light" w="fit-content">
        Compare businesses for this procedure
      </Button>
      {row.business_name && (
        <Button component="a" href={businessHref(row.business_name)} size="xs" variant="light" w="fit-content">
          All procedures at this business
        </Button>
      )}
      {row.description && <Text size="sm">{row.description}</Text>}
      {row.additional_information && (
        <Text size="sm" c="dimmed">
          {row.billing_code_type === 'RC'
            ? `This price is for procedure ${row.additional_information}. The name and description above are how the file labels this revenue code.`
            : `Additional information: ${row.additional_information}`}
        </Text>
      )}
      <Text size="sm" fw={600}>
        NPIs ({npis.length.toLocaleString()} of {row.npi_count.toLocaleString()})
      </Text>
      <Group gap={4} mah={220} style={{ overflowY: 'auto' }}>
        {npis.map((npi) => (
          <Badge key={npi} variant="light" radius="sm">
            {npi}
          </Badge>
        ))}
      </Group>
      {hasMore && (
        <Button size="xs" variant="light" w="fit-content" loading={loading} onClick={loadMore}>
          Load more NPIs
        </Button>
      )}
    </Stack>
  )
}
