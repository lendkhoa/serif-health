import { MantineProvider, createTheme } from '@mantine/core'
import NavigationBar from './NavigationBar.tsx'

const theme = createTheme({
  primaryColor: 'blue',
})

export default function App() {
  return (
    <MantineProvider theme={theme} defaultColorScheme="light">
      <NavigationBar />
    </MantineProvider>
  )
}
