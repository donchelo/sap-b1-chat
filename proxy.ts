import { NextRequest, NextResponse } from "next/server"

// mc-auth is the SSO handoff endpoint — always public
const PUBLIC_PATHS = ["/api/mc-auth", "/_next", "/favicon"]

const COOKIE = "sap_chat_session"

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) return NextResponse.next()

  // Dev-mode escape ONLY outside production. In production, a missing secret
  // is a misconfiguration — fail closed (block) instead of silently allowing.
  if (!process.env.MISSION_CONTROL_SECRET) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Servidor no configurado" }, { status: 500 })
    }
    return NextResponse.next()
  }

  // Valid session = non-empty cookie (verified in depth by session.ts in API routes)
  const session = req.cookies.get(COOKIE)?.value ?? ""
  if (session.length > 0) return NextResponse.next()

  // No session: API calls → 401, pages → lock screen (handled by page.tsx)
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }
  return NextResponse.next() // Page shows lock screen via client-side /api/me check
}

export const proxyConfig = {
  matcher: ["/((?!_next/static|_next/image|favicon).*)"],
}
