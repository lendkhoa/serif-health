import type { Message, Provider } from '../src/priceAi/llm'

/** Replies in order, then repeats the last. An Error is thrown; 'hang' never answers. Records every call. */
export function fakeProvider(replies: unknown[], { name = 'fake', timeoutMs = 1000 } = {}) {
  const calls: Message[][] = []
  const provider: Provider = {
    name,
    timeoutMs,
    async complete(messages) {
      const reply = replies[Math.min(calls.length, replies.length - 1)]
      calls.push(messages)
      if (reply === 'hang') return new Promise(() => {}) // ignores its signal on purpose
      if (reply instanceof Error) throw reply
      return reply
    },
  }
  return { provider, calls }
}
