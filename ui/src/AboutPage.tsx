import {
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Code,
  Container,
  Divider,
  Group,
  List,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core'
import {
  ArrowRight,
  CheckCircle,
  Database,
  FileArrowDown,
  GitBranch,
  MagnifyingGlass,
  WarningCircle,
} from '@phosphor-icons/react'

type AboutPageProps = {
  onBackToSearch: () => void
}

const indexUrl =
  'https://www.centene.com/content/dam/centene/Centene%20Corporate/json/DOCUMENT/2026-08-31_fidelis_index.json'

const requirements = [
  ['Index-driven source selection', 'Used the Centene / Fidelis Transparency in Coverage index to select an in-network rate file and preserve its source metadata for traceability.'],
  ['Rate-file ingestion', 'Flattened nested billing items, negotiated prices, provider groups, TINs, and NPIs into indexed D1 tables that are practical to query.'],
  ['Search API', 'Implemented billing-code search with optional NPI and EIN filters, keyset pagination, sorting, validation, and a consistent error shape.'],
  ['Searchable UI', 'Built a responsive Mantine interface with code search, provider filters, formatted results, expandable details, pagination, and loading states.'],
  ['Resilient interactions', 'Fetch, validation, empty-result, and database failures are surfaced as useful UI states instead of crashing the application.'],
] as const

export default function AboutPage({ onBackToSearch }: AboutPageProps) {
  return (
    <Container size="lg" px={{ base: 'sm', sm: 'md' }} py={{ base: 'xl', md: 48 }}>
      <Stack gap={40}>
        <Stack gap="md" maw={760}>
          <Title order={1} size="clamp(2rem, 5vw, 3.5rem)" lh={1.05}>
            A searchable view of negotiated healthcare rates.
          </Title>
          <Text size="lg" c="dimmed" maw={680}>
            Serif Health Price Transparency Explorer turns a large CMS-style transparency file into a focused search experience for billing codes, negotiated rates, and provider organizations.
          </Text>
          <Group>
            <Button leftSection={<MagnifyingGlass size={18} />} onClick={onBackToSearch}>
              Explore rates
            </Button>
            <Anchor href={indexUrl} target="_blank" rel="noreferrer" size="sm">
              View the source index
            </Anchor>
          </Group>
        </Stack>

        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
          <Card withBorder padding="lg" radius="md">
            <ThemeIcon size="lg" variant="light"><FileArrowDown size={20} /></ThemeIcon>
            <Text fw={700} mt="md">Index → rate file</Text>
            <Text size="sm" c="dimmed" mt="xs">A hand-selected Fidelis in-network file keeps the timeboxed scope explicit.</Text>
          </Card>
          <Card withBorder padding="lg" radius="md">
            <ThemeIcon size="lg" variant="light" color="teal"><Database size={20} /></ThemeIcon>
            <Text fw={700} mt="md">Nested JSON → D1</Text>
            <Text size="sm" c="dimmed" mt="xs">Normalized tables and indexes make repeated searches fast and reproducible.</Text>
          </Card>
          <Card withBorder padding="lg" radius="md">
            <ThemeIcon size="lg" variant="light" color="violet"><MagnifyingGlass size={20} /></ThemeIcon>
            <Text fw={700} mt="md">API → React UI</Text>
            <Text size="sm" c="dimmed" mt="xs">The Worker owns validation and query strategy; the UI owns exploration and feedback.</Text>
          </Card>
        </SimpleGrid>

        <Stack gap="lg">
          <Stack gap="xs">
            <Text tt="uppercase" fw={700} size="xs" c="blue">Assignment alignment</Text>
            <Title order={2}>What is implemented</Title>
            <Text c="dimmed" maw={720}>The implementation focuses on the requested end-to-end path while keeping the ingestion and query layers easy to extend.</Text>
          </Stack>
          <Stack gap="sm">
            {requirements.map(([title, description]) => (
              <Card key={title} withBorder padding="md" radius="md">
                <Group align="flex-start" wrap="nowrap">
                  <ThemeIcon color="green" variant="light" radius="xl"><CheckCircle size={18} /></ThemeIcon>
                  <Box><Text fw={700}>{title}</Text><Text size="sm" c="dimmed" mt={4}>{description}</Text></Box>
                </Group>
              </Card>
            ))}
          </Stack>
        </Stack>

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xl">
          <Stack gap="md">
            <Title order={2}>Key decisions</Title>
            <List spacing="sm" icon={<ThemeIcon color="blue" size={22} radius="xl"><ArrowRight size={13} /></ThemeIcon>}>
              <List.Item><Text span fw={600}>D1 over in-memory data:</Text> persistence and indexes avoid re-parsing a large file for every Worker session.</List.Item>
              <List.Item><Text span fw={600}>Keyset pagination:</Text> stable cursors avoid expensive offsets as result sets grow.</List.Item>
              <List.Item><Text span fw={600}>One row per organization and rate:</Text> provider counts stay readable, with NPIs available in the expanded row.</List.Item>
              <List.Item><Text span fw={600}>Provenance stays attached:</Text> source URL and source update date can travel with search results.</List.Item>
            </List>
          </Stack>

          <Card withBorder padding="lg" radius="md" bg="var(--mantine-color-gray-0)">
            <Group gap="xs"><WarningCircle size={20} /><Title order={3}>Honest scope</Title></Group>
            <Text size="sm" c="dimmed" mt="sm">The file selection and ingest are intentionally timeboxed. The app currently registers one chosen source file; a production version would automate index discovery and multi-file ingestion.</Text>
            <Divider my="md" />
            <Text size="sm" fw={600}>With more time I would add:</Text>
            <List size="sm" c="dimmed" mt="xs" spacing="xs">
              <List.Item>Automated index and file download orchestration</List.Item>
              <List.Item>Full-text descriptions and autocomplete</List.Item>
              <List.Item>Code-level summaries, trends, and export workflows</List.Item>
              <List.Item>Broader fixture coverage for CMS edge cases</List.Item>
            </List>
          </Card>
        </SimpleGrid>

        <Card withBorder padding="lg" radius="md">
          <Group gap="xs"><GitBranch size={20} /><Title order={3}>Run it locally</Title></Group>
          <Text size="sm" c="dimmed" mt="sm">The repository includes the install, local D1 migration, ingestion, development, and deployment workflow in the Makefile.</Text>
          <Code block mt="md">{'make install\nmake d1-migrate LOCAL=1\nmake dev'}</Code>
        </Card>
      </Stack>
    </Container>
  )
}
