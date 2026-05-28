import { NextResponse } from "next/server"

const CHANGELOG_URL =
  "https://changelog-service-silk.vercel.app/api/changelog/tamaprint/sap-b1-chat"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const limit = searchParams.get("limit") ?? "20"

  const res = await fetch(`${CHANGELOG_URL}?limit=${limit}`, {
    next: { revalidate: 300 },
  })

  if (!res.ok) {
    return NextResponse.json({ error: "changelog unavailable" }, { status: res.status })
  }

  const data = await res.json()
  return NextResponse.json(data)
}
