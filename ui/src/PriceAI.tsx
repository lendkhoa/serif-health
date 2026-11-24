import {
  Button,
  Container,
  Group,
  useComputedColorScheme,
  useMantineTheme,
} from "@mantine/core";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { ChatBox } from "@mui/x-chat";
import { useMemo, useRef, useState } from "react";
import examplePrompt from "../../samples/price-ai/employer-prompt.txt?raw";
import { clearChat, readDraft, readMessages, saveDraft, saveMessages } from "./chatStorage";
import { priceAiAdapter } from "./priceAiAdapter";

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
        text: "Hello! Describe your plan and expected use, and I will recommend providers. Try the example prompt below.",
      },
    ],
  },
];

// A placeholder cannot be sent, so the suggestion fills the composer with the same prompt.
const suggestions = [{ value: examplePrompt, label: "Use the example prompt" }];
const slotProps = { composerInput: { placeholder: examplePrompt, maxRows: 8 } };
const features = { attachments: false };

/** Minimal chat page for summarizing a user's plan and finding best-value providers. */
export default function PriceAI() {
  const mantine = useMantineTheme();
  const isDark = useComputedColorScheme("light") === "dark";

  // Clearing remounts the chat. A reply still running for the old one must not save over the new one.
  const [session, setSession] = useState(() => ({
    id: 0,
    messages: readMessages() ?? initialMessages,
    draft: readDraft(),
  }));
  const currentId = useRef(0);
  const clear = () => {
    clearChat();
    currentId.current += 1;
    setSession({ id: currentId.current, messages: initialMessages, draft: "" });
  };
  const ifCurrent =
    <T,>(save: (value: T) => void) =>
    (value: T) => {
      if (session.id === currentId.current) save(value);
    };

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
        <Group justify="flex-end" mb="xs">
          <Button variant="subtle" size="compact-sm" onClick={clear}>
            Clear chat
          </Button>
        </Group>
        <ChatBox
          key={session.id}
          adapter={priceAiAdapter}
          suggestions={suggestions}
          slotProps={slotProps}
          features={features}
          initialConversations={initialConversations}
          initialActiveConversationId={CONVERSATION_ID}
          initialMessages={session.messages}
          initialComposerValue={session.draft}
          onMessagesChange={ifCurrent(saveMessages)}
          onComposerValueChange={ifCurrent(saveDraft)}
          sx={{
            height: "max(560px, calc(100vh - 216px))",
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1,
            "& table": { display: "block", overflowX: "auto", borderCollapse: "collapse" },
            "& th, & td": { px: 1, py: 0.5, textAlign: "left", overflowWrap: "normal", wordBreak: "normal", borderBottom: "1px solid", borderColor: "divider" },
            "& textarea": { minHeight: "96px !important" },
          }}
        />
      </Container>
    </ThemeProvider>
  );
}
