import { Button, Container, Group, Select, Stack, Text } from '@mantine/core'
import { DataTable, type DataTableSortStatus } from 'mantine-datatable'
import { useEffect, useRef, useState } from 'react'
import RateFilterBar from './RateFilterBar.tsx'
import RowDetails from './RowDetails.tsx'
import { RATE_COLUMN_GROUPS } from './columns.tsx'
import { EMPTY_FILTERS, rowId, type RateRow, type RateSort } from './types.ts'
import { useRates } from './useRates.ts'

const PAGE_SIZES = ['25', '50', '100', '200']

export default function RatesPage() {
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [sort, setSort] = useState<RateSort>('rate_desc')
  const [limit, setLimit] = useState(50)
  const rates = useRates({ filters, sort, limit })
  const { rows, loading, failed, page, hasNext } = rates
  const viewport = useRef<HTMLDivElement>(null)

  useEffect(() => {
    viewport.current?.scrollTo({ top: 0 })
  }, [page])

  const sortStatus: DataTableSortStatus<RateRow> = {
    columnAccessor: 'negotiated_rate',
    direction: sort === 'rate_asc' ? 'asc' : 'desc',
  }
  const emptyText = !filters.code
    ? 'Enter a billing code to see its negotiated rates'
    : failed
      ? 'The rates could not be loaded'
      : 'No rates match these filters'
  const first = page * limit + 1

  return (
    <Container fluid px={{ base: 'sm', sm: 'md' }} py="md">
      <Stack gap="md">
        <RateFilterBar applied={filters} onApply={setFilters} />

        <DataTable<RateRow>
          height="max(360px, calc(100dvh - 290px))"
          withTableBorder
          withColumnBorders
          striped
          highlightOnHover
          borderRadius="sm"
          verticalSpacing="xs"
          pinFirstColumn
          groups={RATE_COLUMN_GROUPS}
          records={rows}
          idAccessor={rowId}
          fetching={loading}
          noRecordsText={loading ? 'Loading rates' : emptyText}
          sortStatus={sortStatus}
          onSortStatusChange={(s) => setSort(s.direction === 'asc' ? 'rate_asc' : 'rate_desc')}
          rowExpansion={{ content: ({ record }) => <RowDetails row={record} /> }}
          scrollViewportRef={viewport}
        />

        <Group justify="space-between">
          <Text size="sm" c="dimmed" aria-live="polite">
            {loading
              ? 'Loading'
              : rows.length
                ? `Rows ${first.toLocaleString()}-${(first + rows.length - 1).toLocaleString()}${hasNext ? ', more available' : ' (end of results)'}`
                : ''}
          </Text>
          <Group gap="xs">
            {failed && (
              <Button color="red" variant="light" onClick={rates.retry}>
                Try again
              </Button>
            )}
            <Select
              aria-label="Rows per page"
              w={130}
              allowDeselect={false}
              data={PAGE_SIZES.map((n) => ({ value: n, label: `${n} rows` }))}
              value={String(limit)}
              onChange={(v) => v && setLimit(Number(v))}
            />
            <Button variant="default" disabled={loading || page === 0} onClick={rates.firstPage}>
              First
            </Button>
            <Button variant="default" disabled={loading || page === 0} onClick={rates.previous}>
              Previous
            </Button>
            <Text size="sm">Page {page + 1}</Text>
            <Button variant="default" disabled={loading || !hasNext} onClick={rates.next}>
              Next
            </Button>
          </Group>
        </Group>
      </Stack>
    </Container>
  )
}
