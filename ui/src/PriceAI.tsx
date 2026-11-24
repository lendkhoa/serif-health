import {
  Container,
  useComputedColorScheme,
  useMantineTheme,
} from "@mantine/core";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { ChatBox, createEchoAdapter } from "@mui/x-chat";
import { useMemo } from "react";

const CONVERSATION_ID = "price-ai";

const initialConversations = [{ id: CONVERSATION_ID, title: "Price AI" }];

const initialMessages = [
  {
    id: "welcome",
    conversationId: CONVERSATION_ID,
    role: "assistant" as const,
    status: "sent" as const,
    parts: [
      {
        type: "text" as const,
        text: "Hello! Ask me about your health plan or the price of a procedure.",
      },
    ],
  },
];

// Placeholder: swap for an adapter that calls the Price AI API.
const adapter = createEchoAdapter();

/** Minimal chat page for summarizing a user's plan and finding best-value providers. */
export default function PriceAI() {
  const mantine = useMantineTheme();
  const isDark = useComputedColorScheme("light") === "dark";

  // Mirror Mantine's color scheme, palette and font so the chat follows the app's light/dark toggle.
  const muiTheme = useMemo(
    () =>
      createTheme({
        palette: {
          mode: isDark ? "dark" : "light",
          primary: { main: mantine.colors.blue[isDark ? 4 : 6] },
          divider: isDark ? mantine.colors.dark[4] : mantine.colors.gray[3],
          ...(isDark && {
            background: {
              default: mantine.colors.dark[7],
              paper: mantine.colors.dark[6],
            },
            text: {
              primary: mantine.colors.dark[0],
              secondary: mantine.colors.dark[2],
            },
          }),
        },
        typography: { fontFamily: mantine.fontFamily },
      }),
    [isDark, mantine],
  );

  return (
    <ThemeProvider theme={muiTheme}>
      <Container size="lg" px={{ base: "sm", sm: "md" }} py="xl">
        <ChatBox
          adapter={adapter}
          initialConversations={initialConversations}
          initialActiveConversationId={CONVERSATION_ID}
          initialMessages={initialMessages}
          sx={{
            height: 560,
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1,
          }}
        />
      </Container>
    </ThemeProvider>
  );
}
