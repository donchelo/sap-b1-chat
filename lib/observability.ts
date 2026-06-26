import { configureTransport, setServiceName } from "@ai4u/platform/logger"

let started = false
export function bootstrapObservability(): void {
  if (started) return
  started = true
  setServiceName("sap-b1-chat")
  const endpoint = process.env.PLATFORM_INGEST_URL
  const secret = process.env.INGEST_SECRET
  if (endpoint && secret) configureTransport({ endpoint, secret })
}
