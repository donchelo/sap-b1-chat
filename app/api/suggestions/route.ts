// ─── /api/suggestions ────────────────────────────────────────────────────────
// Genera 4 preguntas estratégicas de negocio para el tenant activo,
// usando el mismo backend de SAP B1 como LLM (no requiere nueva API key).
//
// POST { apiKey: string }
// → { questions: string[], generatedAt: number }
// ─────────────────────────────────────────────────────────────────────────────

const BACKEND_URL =
  process.env.BACKEND_URL ??
  process.env.NEXT_PUBLIC_BACKEND_URL ??
  "http://localhost:4100"

const FALLBACK: string[] = [
  "¿Cuál es el margen bruto por línea de producto este mes vs. el mes anterior?",
  "¿Qué clientes no han comprado en los últimos 60 días y tienen historial alto?",
  "¿Qué materiales están por debajo del stock mínimo esta semana?",
  "¿Cuáles son los 5 productos con mayor crecimiento de demanda en el último trimestre?",
]

function buildPrompt(today: string, tenantName: string): string {
  return `Eres un consultor estratégico con expertise en SAP Business One.

La empresa es ${tenantName}. Tu tarea es generar 4 preguntas estratégicas de alto valor que el dueño debería hacerle al sistema SAP hoy (${today}).

Cubre exactamente estas categorías, una por pregunta:
1. FINANZAS: márgenes, rentabilidad, flujo de caja, cuentas por cobrar/pagar
2. CLIENTES Y VENTAS: concentración, crecimiento, ticket promedio, frecuencia de compra
3. OPERACIONES: inventario, materiales, producción, tiempos, eficiencia
4. ESTRATEGIA: tendencias, comparativas periodo anterior, oportunidades de mejora

Criterios:
- Cada pregunta debe ser respondible con datos reales de SAP B1
- Deben ser específicas para el giro de ${tenantName} (no genéricas)
- Deben generar insights accionables para tomar decisiones esta semana
- Varía el horizonte temporal entre preguntas (hoy, semana, mes, trimestre)

Responde ÚNICAMENTE con un JSON array de 4 strings, sin markdown ni texto adicional. Ejemplo exacto del formato:
["¿Pregunta 1?", "¿Pregunta 2?", "¿Pregunta 3?", "¿Pregunta 4?"]`
}

function parseQuestions(raw: string): string[] | null {
  // Busca el primer array JSON válido en la respuesta del LLM
  const match = raw.match(/\[[\s\S]*?\]/) ?? raw.match(/\[[\s\S]*\]/)
  if (!match) return null
  try {
    const parsed: unknown = JSON.parse(match[0])
    if (
      !Array.isArray(parsed) ||
      parsed.some((q) => typeof q !== "string" || q.trim().length < 10)
    )
      return null
    return (parsed as string[]).slice(0, 4)
  } catch {
    return null
  }
}

export async function POST(req: Request) {
  // API key resolved server-side from session cookie
  const { getApiKey, getTenantId } = await import("@/app/lib/session")
  const [apiKey, tenantId] = await Promise.all([getApiKey(), getTenantId()])

  if (!apiKey) {
    return Response.json({ error: "Sesión no válida. Accede desde Mission Control." }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const { tenantName } = body as { tenantName?: string }
  const resolvedTenant = tenantName?.trim() || tenantId || "la empresa"

  const today = new Date().toLocaleDateString("es", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/Mexico_City",
  })

  // Llamar al backend con el meta-prompt
  let upstream: Response
  try {
    upstream = await fetch(`${BACKEND_URL}/api/v1/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: buildPrompt(today, resolvedTenant) }],
      }),
      signal: AbortSignal.timeout(25_000),
    })
  } catch {
    return Response.json({ questions: FALLBACK, generatedAt: Date.now(), source: "fallback" })
  }

  if (!upstream.ok) {
    return Response.json({ questions: FALLBACK, generatedAt: Date.now(), source: "fallback" })
  }

  // Acumular stream completo (no necesitamos streaming aquí)
  const reader = upstream.body!.getReader()
  const decoder = new TextDecoder()
  let raw = ""
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      raw += decoder.decode(value, { stream: true })
    }
  } catch {
    return Response.json({ questions: FALLBACK, generatedAt: Date.now(), source: "fallback" })
  }

  const questions = parseQuestions(raw)
  if (!questions || questions.length === 0) {
    return Response.json({ questions: FALLBACK, generatedAt: Date.now(), source: "fallback" })
  }

  return Response.json({ questions, generatedAt: Date.now(), source: "llm" })
}
