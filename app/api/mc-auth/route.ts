import { NextRequest, NextResponse } from "next/server"
import { verifyMcToken, createSession } from "@ai4u/mc-sso"
import { COOKIE } from "@/app/lib/session"

const SERVICE_ID     = "sapb1chat"
const SESSION_TTL_S  = 8 * 60 * 60
const SESSION_TTL_MS = SESSION_TTL_S * 1000

// POST binding: the SSO token arrives in the form body (never the URL), sent by
// Mission Control's /api/handoff auto-submitting form.
export async function POST(req: NextRequest) {
  const form   = await req.formData()
  const token  = String(form.get("token") ?? "")
  const secret = process.env.MISSION_CONTROL_SECRET
  if (!secret) {
    return NextResponse.json({ error: "Configuración de servidor incompleta" }, { status: 500 })
  }

  const data = verifyMcToken(token, SERVICE_ID, secret)
  if (!data) {
    return NextResponse.json({ error: "Token inválido o expirado" }, { status: 401 })
  }

  const sessionToken = createSession(data.tenantId, secret, SESSION_TTL_MS)
  // 303 so the browser follows the redirect as GET (not re-POSTing to "/").
  const res = NextResponse.redirect(new URL("/", req.url), 303)
  res.cookies.set(COOKIE, sessionToken, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge:   SESSION_TTL_S,
    path:     "/",
  })
  return res
}
