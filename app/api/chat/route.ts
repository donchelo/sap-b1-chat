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

  // UIMessage[] → { role, content } that the backend expects
  const normalized = (
    messages as Array<{
      role: string
      parts: Array<{ type: string; text?: string }>
    }>
  ).map((msg) => ({
    role: msg.role,
    content: msg.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join(""),
  }))

  const upstream = await fetch(`${BACKEND_URL}/api/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify({ messages: normalized }),
  })

  if (!upstream.ok) {
    const err = await upstream.json().catch(() => ({ error: upstream.statusText }))
    return Response.json(
      { error: err.error ?? upstream.statusText },
      { status: upstream.status },
    )
  }

  return new Response(upstream.body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  })
}
