import { ApiError, ERROR_CODES, badRequest } from './errors'

/** Reads a JSON body, giving up as soon as it passes `maxBytes`: Content-Length is optional and can lie. */
export async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const tooLarge = () => new ApiError(ERROR_CODES.BODY_TOO_LARGE, 413)
  if (Number(request.headers.get('Content-Length')) > maxBytes) throw tooLarge()

  let text = ''
  if (request.body) {
    const reader = (request.body as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
    let size = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > maxBytes) {
          await reader.cancel().catch(() => {})
          throw tooLarge()
        }
        text += decoder.decode(value, { stream: true })
      }
      text += decoder.decode()
    } catch (err) {
      if (err instanceof TypeError) throw badRequest(ERROR_CODES.INVALID_JSON) // not UTF-8
      throw err
    }
  }
  try {
    return JSON.parse(text)
  } catch {
    throw badRequest(ERROR_CODES.INVALID_JSON)
  }
}
