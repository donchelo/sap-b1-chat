import { NextRequest, NextResponse } from "next/server"
import { verifyMcToken, createSession } from "@ai4u/mc-sso"
import { COOKIE } from "@/app/lib/session"

const SERVICE_ID     = "sapb1chat"
const SESSION_TTL_S  = 8 * 60 * 60
const SESSION_TTL_MS = SESSION_TTL_S * 1000

export async function GET(req: NextRequest) {
  const token  = req.nextUrl.searchParams.get("token") ?? ""
  const secret = process.env.MISSION_CONTROL_SECRET
  if (!secret) {
    return NextResponse.json({ error: "Configuración de servidor incompleta" }, { status: 500 })
  }

  const data = verifyMcToken(token, SERVICE_ID, secret)
  if (!data) {
    return NextResponse.json({ error: "Token inválido o expirado" }, { status: 401 })
  }

  const sessionToken = createSession(data.tenantId, secret, SESSION_TTL_MS)
  const res = NextResponse.redirect(new URL("/", req.url))
  res.cookies.set(COOKIE, sessionToken, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge:   SESSION_TTL_S,
    path:     "/",
  })
  return res
}
