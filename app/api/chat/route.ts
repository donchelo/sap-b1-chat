import { convertToModelMessages } from "ai"

const BACKEND_URL =
  process.env.BACKEND_URL ??
  process.env.NEXT_PUBLIC_BACKEND_URL ??
  "http://localhost:4100"

const PROXY_TIMEOUT_MS = 120_000 // 2 min — ajusta si SAP tarda más

export async function POST(req: Request) {
  const body = await req.json()
  const { messages, apiKey } = body

  if (!apiKey) {
    return Response.json({ error: "apiKey requerido" }, { status: 401 })
  }

  // UIMessage[] → ModelMessage[] (preserva tool calls, tool results, etc.)
  const modelMessages = await convertToModelMessages(messages)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS)

  let upstream: Response
  try {
    upstream = await fetch(`${BACKEND_URL}/api/v1/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
        // Tell the backend this client expects the UI message stream protocol
        "x-vercel-ai-ui-message-stream": "v1",
      },
      body: JSON.stringify({ messages: modelMessages }),
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timeoutId)
    const isAbort = err instanceof Error && err.name === "AbortError"
    const message = isAbort
      ? `Tiempo de espera agotado (>${PROXY_TIMEOUT_MS / 1000}s) — el backend no respondió`
      : `Backend no disponible (${BACKEND_URL}) — verifique que el servicio esté activo`
    return Response.json({ error: message }, { status: isAbort ? 504 : 502 })
  }
  clearTimeout(timeoutId)

  if (!upstream.ok) {
    const err = await upstream.json().catch(() => ({ error: upstream.statusText }))
    return Response.json(
      { error: err.error ?? upstream.statusText },
      { status: upstream.status },
    )
  }

  const upstreamContentType = upstream.headers.get("Content-Type") ?? ""
  const isUIMessageStream =
    upstream.headers.has("x-vercel-ai-ui-message-stream") ||
    upstreamContentType.includes("text/event-stream")

  const responseHeaders = new Headers({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    "x-vercel-ai-ui-message-stream": "v1",
  })
  const sessionId = upstream.headers.get("X-Session-Id")
  if (sessionId) responseHeaders.set("X-Session-Id", sessionId)

  // New backend: already emits the UI message stream protocol → pass through
  if (isUIMessageStream) {
    return new Response(upstream.body, { headers: responseHeaders })
  }

  // Legacy backend: plain text stream → wrap as minimal UI message stream
  // so DefaultChatTransport (parseJsonEventStream) can consume it.
  const textId = crypto.randomUUID()
  const enc = new TextEncoder()

  function sseEvent(chunk: Record<string, unknown>): Uint8Array {
    return enc.encode(`data: ${JSON.stringify(chunk)}\n\n`)
  }

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const writer = writable.getWriter()

  ;(async () => {
    try {
      writer.write(sseEvent({ type: "start-step" }))
      writer.write(sseEvent({ type: "text-start", id: textId }))

      const reader = upstream.body!.getReader()
      const dec = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const delta = dec.decode(value, { stream: true })
        if (delta) writer.write(sseEvent({ type: "text-delta", id: textId, delta }))
      }

      writer.write(sseEvent({ type: "text-end", id: textId }))
      writer.write(sseEvent({ type: "finish-step" }))
    } catch {
      // stream aborted by client — nothing to do
    } finally {
      writer.close()
    }
  })()

  return new Response(readable, { headers: responseHeaders })
}
