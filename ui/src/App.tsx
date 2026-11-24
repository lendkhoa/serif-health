import { Button, Center, Container, Loader, MantineProvider, Tabs, createTheme } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { Suspense, lazy, useEffect, useState } from 'react'
import NavigationBar from './NavigationBar.tsx'
import { clearApiCache } from './apiCache.ts'
import { LENSES, lensHref, useLens, type LensId } from './lenses.ts'
import RatesPage from './rates/RatesPage.tsx'
import AboutPage from './AboutPage.tsx'

export type AppPage = 'search' | 'about'

// Charts are heavy, so they load only when the lens is opened.
const BusinessPage = lazy(() => import('./business/BusinessPage.tsx'))
const ChargesPage = lazy(() => import('./charges/ChargesPage.tsx'))

const theme = createTheme({
  primaryColor: 'blue',
})

export default function App() {
  const { lens, params } = useLens()
  const [page, setPage] = useState<AppPage>(() => window.location.pathname.endsWith('/about') ? 'about' : 'search')

  useEffect(() => {
    const onPopState = () => setPage(window.location.pathname.endsWith('/about') ? 'about' : 'search')
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigate = (next: AppPage) => {
    const path = next === 'about' ? '/app/about' : '/app/rates'
    window.history.pushState({}, '', path)
    setPage(next)
  }

  return (
    <MantineProvider theme={theme} defaultColorScheme="light">
      <Notifications position="top-right" limit={5} />
      <NavigationBar page={page} onNavigate={navigate} />
      {page === 'about' ? <AboutPage onBackToSearch={() => navigate('search')} /> : <>
      <Container fluid px={{ base: 'sm', sm: 'md' }} pt="xs">
        <Tabs value={lens} onChange={(id) => id && (window.location.hash = lensHref(id as LensId))}>
          <Tabs.List>
            {LENSES.map((l) => (
              <Tabs.Tab key={l.id} value={l.id}>
                {l.label}
              </Tabs.Tab>
            ))}
            <Button ml="auto" my="auto" size="xs" variant="subtle" onClick={clearApiCache}>
              Refresh data
            </Button>
          </Tabs.List>
        </Tabs>
      </Container>
      {/* Stays mounted so its filters and page survive a visit to another lens, but only fetches when shown. */}
      <div hidden={lens !== 'rates'}>
        <RatesPage active={lens === 'rates'} />
      </div>
      {lens === 'charges' && (
        <Suspense fallback={<Center p="xl"><Loader /></Center>}>
          <ChargesPage code={params.get('code') ?? ''} service={params.get('service')} />
        </Suspense>
      )}
      {lens === 'business' && (
        <Suspense fallback={<Center p="xl"><Loader /></Center>}>
          <BusinessPage name={params.get('name') ?? ''} />
        </Suspense>
      )}
      </>}
    </MantineProvider>
  )
}
