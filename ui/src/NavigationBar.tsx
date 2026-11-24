import {
  ActionIcon,
  Anchor,
  Badge,
  Container,
  Group,
  Menubar,
  Menu,
  Paper,
  Tooltip,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core'
import { GithubLogo, HandWavingIcon, MagnifyingGlass, Moon, Sun } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { apiGetWithToast } from './api.ts'
import type { AppPage } from './App.tsx'

type NavigationBarProps = { page: AppPage; onNavigate: (page: AppPage) => void }

export default function NavigationBar({ page, onNavigate }: NavigationBarProps) {
  const [apiOk, setApiOk] = useState<boolean | null>(null)
  const { setColorScheme } = useMantineColorScheme()
  const computedColorScheme = useComputedColorScheme('light')
  const isDark = computedColorScheme === 'dark'

  useEffect(() => {
    apiGetWithToast('/api/health')
      .then(() => setApiOk(true))
      .catch(() => setApiOk(false))
  }, [])

  return (
    <Paper component="header" withBorder radius={0} shadow="sm">
      <Container size="xl" px={{ base: 'sm', sm: 'md' }} py="sm">
        <Menubar aria-label="Main navigation" style={{ minHeight: '3.5rem' }}>
          <Group gap="xs" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
            <HandWavingIcon size={24} aria-hidden="true" style={{ flexShrink: 0 }} />
            <Anchor
              href="https://serif-health-assignment.khoale.workers.dev/app#/rates"
              c="inherit"
              underline="never"
              fw={700}
              size="clamp(0.85rem, 3.5vw, 1.1rem)"
              truncate
            >
              Serif Health Price Transparency Project
            </Anchor>
          </Group>

          <Badge color={apiOk === null ? 'gray' : apiOk ? 'green' : 'red'} variant="light">
            API: {apiOk === null ? '...' : apiOk ? 'ok' : 'down'}
          </Badge>

          <Menubar.Menu>
            <Menubar.Target>More</Menubar.Target>
            <Menubar.Dropdown>
              <Menu.Item onClick={() => onNavigate('about')} aria-current={page === 'about' ? 'page' : undefined}>About the project</Menu.Item>
            </Menubar.Dropdown>
          </Menubar.Menu>

          <Group gap="xs" wrap="nowrap">
            <Tooltip label="GitHub">
              <ActionIcon
                component="a"
                href="https://github.com/lendkhoa/serif-health"
                target="_blank"
                rel="noreferrer"
                variant="subtle"
                size="lg"
                aria-label="View the project on GitHub"
              >
                <GithubLogo size={20} aria-hidden="true" />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Search">
              <ActionIcon variant="subtle" size="lg" aria-label="Search" onClick={() => onNavigate('search')}>
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
