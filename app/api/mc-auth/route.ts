import { NextRequest, NextResponse } from "next/server"
import { createHmac, timingSafeEqual } from "crypto"

const COOKIE  = "sap_chat_session"
const SERVICE = "sapb1chat"

interface McTokenPayload {
  tenantId: string; serviceId: string; displayName: string; exp: number
}

function verifyMcToken(token: string, secret: string): McTokenPayload | null {
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
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as McTokenPayload
    if (data.exp < Date.now()) return null
    if (data.serviceId !== SERVICE) return null
    return data
  } catch { return null }
}

function signSession(tenantId: string, secret: string): string {
  const payload = Buffer.from(JSON.stringify({ tenantId, iat: Date.now() })).toString("base64url")
  const sig     = createHmac("sha256", secret).update(payload).digest("base64url")
  return `${payload}.${sig}`
}

export async function GET(req: NextRequest) {
  const token  = req.nextUrl.searchParams.get("token") ?? ""
  const secret = process.env.MISSION_CONTROL_SECRET ?? ""

  const data = verifyMcToken(token, secret)
  if (!data) {
    return NextResponse.json({ error: "Token inválido o expirado" }, { status: 401 })
  }

  const sessionToken = signSession(data.tenantId, secret)
  const res = NextResponse.redirect(new URL("/", req.url))
  res.cookies.set(COOKIE, sessionToken, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge:   8 * 60 * 60,
    path:     "/",
  })
  return res
}
