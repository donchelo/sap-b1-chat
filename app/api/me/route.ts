import { getApiKey, getTenantId } from "@/app/lib/session"

const BACKEND_URL =
  process.env.BACKEND_URL ??
  process.env.NEXT_PUBLIC_BACKEND_URL ??
  "http://localhost:4100"

export async function GET() {
  const [apiKey, tenantId] = await Promise.all([getApiKey(), getTenantId()])

  if (!apiKey || !tenantId) {
    return Response.json({ error: "No autorizado" }, { status: 401 })
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/me`, {
      headers: { "X-API-Key": apiKey },
      cache: "no-store",
    })
    if (res.ok) {
      const data = await res.json()
      return Response.json(data)
    }
  } catch { /* backend not reachable */ }

  // Fallback: return tenantId from session
  return Response.json({ tenant: tenantId, name: tenantId })
}
