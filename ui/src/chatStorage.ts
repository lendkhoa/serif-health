import type { ChatMessage } from '@mui/x-chat/headless'

const MESSAGES_KEY = 'serif-health:price-ai-messages'
const DRAFT_KEY = 'serif-health:price-ai-draft'
const MAX_MESSAGES = 40 // keeps the saved chat well under the browser's limit

// Storage can be full, or unavailable in private browsing. The chat still works without it.
function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // See above.
  }
}

const isMessage = (m: unknown): m is ChatMessage => {
  const v = m as Partial<ChatMessage> | null
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.id === 'string' &&
    (v.role === 'user' || v.role === 'assistant') &&
    Array.isArray(v.parts) &&
    v.parts.every((p) => p?.type === 'text' && typeof p.text === 'string')
  )
}

const INTERRUPTED = '\n\nThe page was reloaded before this answer finished. Send the message again to complete it.'

/** Nothing is in flight after a reload, so a message saved mid-answer must not stay "sending". */
function settle(message: ChatMessage): ChatMessage {
  const unfinished = message.status === 'streaming' || message.status === 'sending' || message.status === 'pending'
  if (!unfinished) return message
  const settled: ChatMessage = { ...message, status: 'sent' }
  if (message.role === 'user') return settled
  const text = message.parts.map((p) => (p.type === 'text' ? p.text : '')).join('')
  return { ...settled, parts: [{ type: 'text', text: (text + INTERRUPTED).trim() }] }
}

/** The saved messages, or null if there are none that can be shown. */
export function readMessages(): ChatMessage[] | null {
  try {
    const saved: unknown = JSON.parse(read(MESSAGES_KEY) ?? 'null')
    return Array.isArray(saved) && saved.length > 0 && saved.every(isMessage) ? saved.map(settle) : null
  } catch {
    return null
  }
}

export const saveMessages = (messages: ChatMessage[]) => write(MESSAGES_KEY, JSON.stringify(messages.slice(-MAX_MESSAGES)))
export const readDraft = () => read(DRAFT_KEY) ?? ''
export const saveDraft = (value: string) => write(DRAFT_KEY, value)

export function clearChat() {
  try {
    localStorage.removeItem(MESSAGES_KEY)
    localStorage.removeItem(DRAFT_KEY)
  } catch {
    // See above.
  }
}
