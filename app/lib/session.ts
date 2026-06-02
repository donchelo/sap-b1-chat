import { cookies } from "next/headers"
import { verifySession } from "@ai4u/mc-sso"

export const COOKIE = "sap_chat_session"

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
  return process.env[key] ?? "S2S_AUTH"
}
