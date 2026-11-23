import { Paper, Text } from '@mantine/core'

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Paper withBorder p="sm" radius="sm">
      <Text size="sm" c="dimmed">{label}</Text>
      <Text size="xl" fw={600}>{value}</Text>
      {hint && <Text size="xs" c="dimmed">{hint}</Text>}
    </Paper>
  )
}

export function TooltipBox({ title, lines }: { title: string; lines: string[] }) {
  return (
    <Paper withBorder shadow="md" radius="sm" px="sm" py="xs" maw={320}>
      <Text size="sm" fw={600}>{title}</Text>
      {lines.map((l) => <Text key={l} size="sm">{l}</Text>)}
    </Paper>
  )
}

type TickProps = { x?: number | string; y?: number | string; payload?: { value: string } }

/** Category-axis label that links to another lens. `find` maps the category value to its text and target. */
export function LinkTick({ x, y, payload, find }: TickProps & { find: (value: string) => { label: string; title: string; href: string } | undefined }) {
  const target = payload && find(payload.value)
  if (!target) return <g />
  return (
    <a href={target.href} aria-label={target.title}>
      <text x={x} y={y} textAnchor="end" dominantBaseline="central" fontSize={12} fill="var(--mantine-color-anchor)">
        {target.label}
        <title>{target.title}</title>
      </text>
    </a>
  )
}
