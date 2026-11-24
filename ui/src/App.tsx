import { MantineProvider, Tabs, createTheme } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { useEffect, useState } from 'react'
import AboutPage from './AboutPage.tsx'
import ExploreData from './ExploreData.tsx'
import NavigationBar from './NavigationBar.tsx'
import PriceAI from './PriceAI.tsx'

export type AppPage = 'search' | 'price-ai' | 'about'

const PAGE_PATHS: Record<AppPage, string> = {
  search: '/app/rates',
  'price-ai': '/app/price-ai',
  about: '/app/about',
}

function currentPage(): AppPage {
  const path = window.location.pathname
  if (path.endsWith('/about')) return 'about'
  if (path.endsWith('/price-ai')) return 'price-ai'
  // A lens hash (e.g. /app#/rates) links into Explore data. Anything else opens on Price AI.
  return path.endsWith('/rates') || window.location.hash.startsWith('#/') ? 'search' : 'price-ai'
}

const theme = createTheme({
  primaryColor: 'blue',
})

export default function App() {
  const [page, setPage] = useState<AppPage>(currentPage)

  useEffect(() => {
    const onPopState = () => setPage(currentPage())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigate = (next: AppPage) => {
    // Keep the hash, so coming back to Explore data reopens the same lens.
    window.history.pushState({}, '', PAGE_PATHS[next] + window.location.hash)
    setPage(next)
  }

  return (
    <MantineProvider theme={theme} defaultColorScheme="light">
      <Notifications position="top-right" limit={5} />
      <NavigationBar page={page} onNavigate={navigate} />
      {page === 'about' ? <AboutPage onBackToSearch={() => navigate('search')} /> : (
        <Tabs variant="pills" value={page} onChange={(next) => next && navigate(next as AppPage)} keepMounted={false} pt="xs">
          <Tabs.List justify="center">
            <Tabs.Tab value="price-ai">Price AI</Tabs.Tab>
            <Tabs.Tab value="search">Explore data</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="search">
            <ExploreData />
          </Tabs.Panel>
          <Tabs.Panel value="price-ai">
            <PriceAI />
          </Tabs.Panel>
        </Tabs>
      )}
    </MantineProvider>
  )
}
