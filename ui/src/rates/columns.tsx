import { Badge, Group, Text, Tooltip } from '@mantine/core'
import type { DataTableColumnGroup } from 'mantine-datatable'
import type { RateRow } from './types.ts'

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4, minimumFractionDigits: 2 })

/** negotiated_rate is dollars, except for "percentage" prices where it is a percent. */
const formatRate = (r: RateRow) => (r.negotiated_type === 'percentage' ? `${r.negotiated_rate}%` : usd.format(r.negotiated_rate))

const Empty = () => (
  <Text span c="dimmed" size="sm" aria-label="No value">
    -
  </Text>
)

const text = (value: string | number | null) => (value === null || value === '' ? <Empty /> : value)

function LongText({ value }: { value: string | null }) {
  if (!value) return <Empty />
  return (
    <Tooltip label={value} multiline maw={420} openDelay={300}>
      <Text size="sm" truncate>
        {value}
      </Text>
    </Tooltip>
  )
}

function Tags({ values, total, max = 3 }: { values: (string | number)[] | null; total?: number; max?: number }) {
  if (!values?.length) return <Empty />
  const hidden = (total ?? values.length) - Math.min(values.length, max)
  return (
    <Group gap={4} wrap="nowrap">
      {values.slice(0, max).map((v) => (
        <Badge key={v} variant="light" radius="sm" tt="none" style={{ flexShrink: 0 }}>
          {v}
        </Badge>
      ))}
      {hidden > 0 && (
        <Text span size="xs" c="dimmed">
          +{hidden.toLocaleString()}
        </Text>
      )}
    </Group>
  )
}

/** Every stored field of the source file, grouped the way the JSON nests them. */
export const rateColumnGroups = (sortable: boolean): DataTableColumnGroup<RateRow>[] => [
  {
    id: 'item',
    title: 'Billing item',
    columns: [
      { accessor: 'billing_code', title: 'Code', width: 90, render: (r) => <Text fw={600} size="sm">{r.billing_code}</Text> },
      { accessor: 'billing_code_type', title: 'Code type', width: 100, render: (r) => text(r.billing_code_type) },
      { accessor: 'billing_code_type_version', title: 'Type version', width: 115, render: (r) => text(r.billing_code_type_version) },
      { accessor: 'name', title: 'Name', width: 220, render: (r) => <LongText value={r.name} /> },
      { accessor: 'description', title: 'Description', width: 280, render: (r) => <LongText value={r.description} /> },
      { accessor: 'negotiation_arrangement', title: 'Arrangement', width: 120, render: (r) => text(r.negotiation_arrangement) },
    ],
  },
  {
    id: 'price',
    title: 'Negotiated price',
    columns: [
      { accessor: 'negotiated_rate', title: 'Rate', width: 130, sortable, textAlign: 'right', render: (r) => <Text fw={600} size="sm" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatRate(r)}</Text> },
      { accessor: 'negotiated_type', title: 'Rate type', width: 120, render: (r) => text(r.negotiated_type) },
      { accessor: 'billing_class', title: 'Class', width: 120, render: (r) => text(r.billing_class) },
      { accessor: 'setting', title: 'Setting', width: 110, render: (r) => text(r.setting) },
      { accessor: 'service_code', title: 'Service codes', width: 170, render: (r) => <Tags values={r.service_code} /> },
      { accessor: 'billing_code_modifier', title: 'Modifiers', width: 150, render: (r) => <Tags values={r.billing_code_modifier} /> },
      { accessor: 'expiration_date', title: 'Expires', width: 115, render: (r) => text(r.expiration_date) },
      { accessor: 'additional_information', title: 'Additional info', width: 180, render: (r) => <LongText value={r.additional_information} /> },
    ],
  },
  {
    id: 'provider',
    title: 'Provider',
    columns: [
      { accessor: 'business_name', title: 'Business name', width: 240, render: (r) => <LongText value={r.business_name} /> },
      { accessor: 'tin_type', title: 'TIN type', width: 90, render: (r) => text(r.tin_type) },
      { accessor: 'ein', title: 'TIN', width: 120, render: (r) => text(r.ein) },
      { accessor: 'provider_group_ids', title: 'Provider groups', width: 140, render: (r) => <Tags values={r.provider_group_ids} /> },
      { accessor: 'npi_count', title: 'NPI count', width: 100, textAlign: 'right', render: (r) => r.npi_count.toLocaleString() },
      { accessor: 'npis', title: 'NPIs (click row for all)', width: 270, render: (r) => <Tags values={r.npis} total={r.npi_count} max={2} /> },
    ],
  },
]
