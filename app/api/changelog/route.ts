import { NextResponse } from "next/server"

const CHANGELOG_URL = process.env.CHANGELOG_URL

export async function GET(req: Request) {
  if (!CHANGELOG_URL) {
    return NextResponse.json({ error: "changelog not configured" }, { status: 503 })
  }

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
