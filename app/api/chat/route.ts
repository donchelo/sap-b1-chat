import { convertToModelMessages } from "ai"

const BACKEND_URL =
  process.env.BACKEND_URL ??
  process.env.NEXT_PUBLIC_BACKEND_URL ??
  "http://localhost:4100"

export async function POST(req: Request) {
  const body = await req.json()
  const { messages, apiKey } = body

  if (!apiKey) {
    return Response.json({ error: "apiKey requerido" }, { status: 401 })
  }

  // UIMessage[] → ModelMessage[] (preserva tool calls, tool results, etc.)
  const modelMessages = await convertToModelMessages(messages)

  const upstream = await fetch(`${BACKEND_URL}/api/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify({ messages: modelMessages }),
  })

  if (!upstream.ok) {
    const err = await upstream.json().catch(() => ({ error: upstream.statusText }))
    return Response.json(
      { error: err.error ?? upstream.statusText },
      { status: upstream.status },
    )
  }

  // Pasar el UI message stream con los headers correctos del upstream
  const responseHeaders = new Headers()
  const contentType = upstream.headers.get("Content-Type")
  if (contentType) responseHeaders.set("Content-Type", contentType)
  const sessionId = upstream.headers.get("X-Session-Id")
  if (sessionId) responseHeaders.set("X-Session-Id", sessionId)

  return new Response(upstream.body, { headers: responseHeaders })
}
