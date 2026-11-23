import {
  ActionIcon,
  Badge,
  Container,
  Group,
  Menubar,
  Menu,
  Paper,
  Text,
  Tooltip,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core'
import { HandWavingIcon, MagnifyingGlass, Moon, Sun } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'

export default function NavigationBar() {
  const [apiOk, setApiOk] = useState<boolean | null>(null)
  const { setColorScheme } = useMantineColorScheme()
  const computedColorScheme = useComputedColorScheme('light')
  const isDark = computedColorScheme === 'dark'

  useEffect(() => {
    fetch('/api/health')
      .then((response) => setApiOk(response.ok))
      .catch(() => setApiOk(false))
  }, [])

  return (
    <Paper component="header" withBorder radius={0} shadow="sm">
      <Container size="xl" px={{ base: 'sm', sm: 'md' }} py="sm">
        <Menubar aria-label="Main navigation" style={{ minHeight: '3.5rem' }}>
          <Group gap="xs" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
            <HandWavingIcon size={24} aria-hidden="true" style={{ flexShrink: 0 }} />
            <Text fw={700} size="clamp(0.85rem, 3.5vw, 1.1rem)" truncate>
              Serif Health Price Transparency Project
            </Text>
          </Group>

          <Badge color={apiOk === null ? 'gray' : apiOk ? 'green' : 'red'} variant="light">
            API: {apiOk === null ? '...' : apiOk ? 'ok' : 'down'}
          </Badge>

          <Menubar.Menu>
            <Menubar.Target>More</Menubar.Target>
            <Menubar.Dropdown>
              <Menu.Item>About the project</Menu.Item>
            </Menubar.Dropdown>
          </Menubar.Menu>

          <Group gap="xs" wrap="nowrap">
            <Tooltip label="Search">
              <ActionIcon variant="subtle" size="lg" aria-label="Search">
                <MagnifyingGlass size={20} aria-hidden="true" />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={isDark ? 'Use light theme' : 'Use dark theme'}>
              <ActionIcon
                variant="subtle"
                size="lg"
                aria-label={isDark ? 'Use light theme' : 'Use dark theme'}
                onClick={() => setColorScheme(isDark ? 'light' : 'dark')}
              >
                {isDark ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
              </ActionIcon>
            </Tooltip>
          </Group>
        </Menubar>
      </Container>
    </Paper>
  )
}
