import { Button, Center, Container, Loader, Tabs } from '@mantine/core'
import { Suspense, lazy } from 'react'
import { clearApiCache } from './apiCache.ts'
import { LENSES, lensHref, useLens, type LensId } from './lenses.ts'
import RatesPage from './rates/RatesPage.tsx'

// Charts are heavy, so they load only when the lens is opened.
const BusinessPage = lazy(() => import('./business/BusinessPage.tsx'))
const ChargesPage = lazy(() => import('./charges/ChargesPage.tsx'))

/** The tabs for exploring the rates, and whichever lens is selected. */
export default function ExploreData() {
  const { lens, params } = useLens()

  return (
    <>
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
    </>
  )
}
