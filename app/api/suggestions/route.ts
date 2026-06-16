import { timingSafeEqual } from "crypto"
import { createAnthropic } from "@ai-sdk/anthropic"
import { generateText, Output } from "ai"
import { z } from "zod"
import { getTenantProfile } from "@/lib/chat/tenant-profiles"
import { getTenantBackend } from "@/lib/tenant-backends"
import { getApiKey, getTenantId } from "@/app/lib/session"

// ─── /api/suggestions ────────────────────────────────────────────────────────
// Genera 4 preguntas estratégicas de negocio para el tenant activo mediante una
// llamada directa a Anthropic (Haiku, barato) con salida estructurada.
//
// POST { tenantName?: string }  (auth por sesión o x-internal-secret de Mission Control)
// → { questions: string[], generatedAt: number, source: "llm" | "fallback" | "static" }
// ─────────────────────────────────────────────────────────────────────────────

export const maxDuration = 30

const FALLBACK: string[] = [
  "¿Cuál es el margen bruto por línea de producto este mes vs. el mes anterior?",
  "¿Qué clientes no han comprado en los últimos 60 días y tienen historial alto?",
  "¿Qué materiales están por debajo del stock mínimo esta semana?",
  "¿Cuáles son los 5 productos con mayor crecimiento de demanda en el último trimestre?",
]

const MAGDALENA_SUGGESTIONS: string[] = [
  "¿Cuál es la estrategia de posicionamiento de La Magdalena en el segmento de lujo cultural?",
  "¿Cómo podemos expandir la narrativa del Libro Jarupia a nuevos coleccionistas internacionales?",
  "¿Qué oportunidades hay para crecer en el mercado de arte colombiano en el exterior?",
  "¿Cómo optimizar el flujo de ingresos manteniendo la exclusividad y rareza de las piezas?",
]

function buildPrompt(today: string, tenantId: string, tenantNameFallback: string): string {
  let contexto = `La empresa es ${tenantNameFallback}.`
  try {
    const p = getTenantProfile(tenantId)
    contexto =
      `Empresa: ${p.nombre}\n` +
      `Industria: ${p.industria}\n` +
      `Líneas de negocio: ${p.lineasNegocio.join(", ")}\n` +
      `País: ${p.pais} · Moneda: ${p.moneda}`
  } catch {
    /* tenant sin perfil — usa el nombre tal cual */
  }

  return `Eres un consultor estratégico con expertise en SAP Business One.

${contexto}

Genera 4 preguntas estratégicas de alto valor que el dueño debería hacerle hoy (${today}) al sistema SAP B1.

Cubre exactamente estas categorías, una por pregunta:
1. FINANZAS: márgenes, rentabilidad, flujo de caja, cuentas por cobrar/pagar
2. CLIENTES Y VENTAS: concentración, crecimiento, ticket promedio, frecuencia de compra
3. OPERACIONES: inventario, materiales, producción, tiempos, eficiencia
4. ESTRATEGIA: tendencias, comparativas con periodo anterior, oportunidades de mejora

Criterios:
- Cada pregunta debe ser respondible con datos reales de SAP B1.
- Específicas para el giro de la empresa (no genéricas).
- Accionables para tomar decisiones esta semana.
- Varía el horizonte temporal entre preguntas (hoy, semana, mes, trimestre).`
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))

  // Auth: x-internal-secret de Mission Control, o sesión directa
  const internalSecret = req.headers.get("x-internal-secret")
  const expected = process.env.MC_INTERNAL_SECRET || process.env.MISSION_CONTROL_SECRET
  let isInternal = false
  if (internalSecret && expected) {
    try {
      const a = Buffer.from(internalSecret)
      const b = Buffer.from(expected)
      isInternal = a.length === b.length && timingSafeEqual(a, b)
    } catch { /* fall through */ }
  }

  const apiKey   = isInternal ? req.headers.get("x-api-key")   : await getApiKey()
  const tenantId = isInternal ? req.headers.get("x-tenant-id") : await getTenantId()

  if (!apiKey || !tenantId) {
    return Response.json({ error: "Sesión no válida. Accede desde Mission Control." }, { status: 401 })
  }

  // Tenants no-SAP (proxy): sugerencias estáticas
  if (getTenantBackend(tenantId).type === "proxy") {
    return Response.json({ questions: MAGDALENA_SUGGESTIONS, generatedAt: Date.now(), source: "static" })
  }

  const anthropicKey =
    process.env[`${tenantId.toUpperCase()}_ANTHROPIC_API_KEY`] ??
    process.env.ANTHROPIC_API_KEY ??
    ""
  if (!anthropicKey) {
    return Response.json({ questions: FALLBACK, generatedAt: Date.now(), source: "fallback" })
  }

  const { tenantName } = body as { tenantName?: string }
  const resolvedTenant = tenantName?.trim() || tenantId
  const today = new Date().toLocaleDateString("es-CO", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    timeZone: "America/Bogota",
  })

  try {
    const anthropic = createAnthropic({ apiKey: anthropicKey })
    const { output } = await generateText({
      model: anthropic("claude-haiku-4-5"),
      output: Output.object({
        schema: z.object({
          questions: z.array(z.string()).describe("Exactamente 4 preguntas estratégicas"),
        }),
      }),
      prompt: buildPrompt(today, tenantId, resolvedTenant),
      abortSignal: AbortSignal.timeout(25_000),
    })

    const questions = (output.questions ?? [])
      .map((q) => q.trim())
      .filter((q) => q.length >= 10)
      .slice(0, 4)

    if (questions.length === 0) {
      return Response.json({ questions: FALLBACK, generatedAt: Date.now(), source: "fallback" })
    }
    return Response.json({ questions, generatedAt: Date.now(), source: "llm" })
  } catch {
    return Response.json({ questions: FALLBACK, generatedAt: Date.now(), source: "fallback" })
  }
}
