import { MantineProvider, createTheme } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import NavigationBar from './NavigationBar.tsx'

const theme = createTheme({
  primaryColor: 'blue',
})

export default function App() {
  return (
    <MantineProvider theme={theme} defaultColorScheme="light">
      <Notifications position="top-right" limit={5} />
      <NavigationBar />
    </MantineProvider>
  )
}
