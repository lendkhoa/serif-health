import { Container, Stack, Text, Title } from '@mantine/core'

/** Placeholder: will summarize a user's plan and find the best-value providers for their procedures. */
export default function PriceAI() {
  return (
    <Container size="lg" px={{ base: 'sm', sm: 'md' }} py="xl">
      <Stack gap="xs">
        <Title order={2}>Price AI</Title>
        <Text c="dimmed">Coming soon: summarize your health plan and find the best-value providers for your care.</Text>
      </Stack>
    </Container>
  )
}
