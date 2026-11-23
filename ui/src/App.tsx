import { useEffect, useState } from 'react'
import { Badge, Container, Group, Title } from '@mantine/core'

export default function App() {
  const [apiOk, setApiOk] = useState<boolean | null>(null)

  useEffect(() => {
    fetch('/api/health')
      .then((r) => setApiOk(r.ok))
      .catch(() => setApiOk(false))
  }, [])

  return (
    <Container py="xl">
      <Group justify="space-between">
        <Title order={1}>Serif Health</Title>
        <Badge color={apiOk === null ? 'gray' : apiOk ? 'green' : 'red'}>
          API: {apiOk === null ? '...' : apiOk ? 'ok' : 'down'}
        </Badge>
      </Group>
    </Container>
  )
}
