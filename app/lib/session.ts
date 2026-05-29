import { createHmac, timingSafeEqual } from "crypto"
import { cookies } from "next/headers"

const COOKIE = "sap_chat_session"

interface SessionPayload { tenantId: string; iat: number }

function verifySession(token: string, secret: string): SessionPayload | null {
  if (!token || !secret) return null
  const dot = token.lastIndexOf(".")
  if (dot === -1) return null
  const payload  = token.slice(0, dot)
  const sig      = token.slice(dot + 1)
  const expected = createHmac("sha256", secret).update(payload).digest("base64url")
  try {
    const a = Buffer.from(sig,      "base64url")
    const b = Buffer.from(expected, "base64url")
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  } catch { return null }
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString()) as SessionPayload
  } catch { return null }
}

export async function getTenantId(): Promise<string | null> {
  const cookieStore = await cookies()
  const token  = cookieStore.get(COOKIE)?.value ?? ""
  const secret = process.env.MISSION_CONTROL_SECRET ?? ""
  return verifySession(token, secret)?.tenantId ?? null
}

export async function getApiKey(): Promise<string | null> {
  const tenantId = await getTenantId()
  if (!tenantId) return null
  const key = tenantId.toUpperCase().replace(/-/g, "_") + "_SAP_API_KEY"
  return process.env[key] ?? null
}

export { COOKIE }
