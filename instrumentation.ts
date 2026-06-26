// Next.js instrumentation hook — corre una vez al arrancar el runtime de Node.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootstrapObservability } = await import("@/lib/observability")
    bootstrapObservability()
  }
}
