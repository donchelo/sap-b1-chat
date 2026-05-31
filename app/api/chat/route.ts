import { createAnthropic } from "@ai-sdk/anthropic"
import {
  streamText, stepCountIs, pruneMessages,
  createUIMessageStream, createUIMessageStreamResponse,
} from "ai"
import type { ModelMessage, UIMessageStreamWriter } from "ai"
import { getTenantId, getApiKey } from "@/app/lib/session"
import { BackendClient } from "@/lib/backend-client"
import { ENTITY_MAP } from "@/lib/entity-map"
import { buildStaticSystemPrompt, buildDynamicSystemContext } from "@/lib/chat/system-prompt"
import { fetchSapContext } from "@/lib/chat/sap-context"

export const maxDuration = 300

// ── Error classifier ────────────────────────────────────────────
type SapError = { code: string; message: string; retryable: boolean }

function classifySapError(err: unknown): { error: SapError } {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes("timeout"))
    return { error: { code: "SAP_TIMEOUT", message: "SAP B1 no respondió en el tiempo esperado.", retryable: true } }
  if (msg.includes("401") || msg.toLowerCase().includes("login"))
    return { error: { code: "SAP_AUTH", message: "Sesión SAP expirada. Contacta al administrador.", retryable: false } }
  if (msg.includes("404"))
    return { error: { code: "SAP_NOT_FOUND", message: msg, retryable: false } }
  return { error: { code: "SAP_ERROR", message: msg, retryable: false } }
}

// ── Model selection ──────────────────────────────────────────────
const ALLOWED_MODELS = ["claude-haiku-4.5", "claude-sonnet-4.6", "claude-opus-4.8"] as const
type AllowedModel = (typeof ALLOWED_MODELS)[number]
const DEFAULT_MODEL: AllowedModel = "claude-sonnet-4.6"

type ThinkingConfig = { type: "adaptive"; display?: "summarized" | "omitted" }
type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max"
type ModelConfig = { thinking?: ThinkingConfig; effort?: EffortLevel }

const MODEL_CONFIGS: Record<AllowedModel, ModelConfig> = {
  "claude-haiku-4.5":  {},
  "claude-sonnet-4.6": { thinking: { type: "adaptive" }, effort: "medium" },
  "claude-opus-4.8":   { thinking: { type: "adaptive", display: "summarized" }, effort: "high" },
}

function toApiSlug(model: AllowedModel): string {
  return model.replace(/(\d)\.(\d)/g, "$1-$2")
}

// ── OData URL builders ───────────────────────────────────────────
function buildDocUrl(entityKey: string, id: string, expand?: string, select?: string): string {
  const cfg = ENTITY_MAP[entityKey]
  const sapEntity = cfg?.sapEntity ?? entityKey
  const key = cfg?.keyType === "string" ? `('${encodeURIComponent(id)}')` : `(${id})`
  const parts: string[] = []
  if (expand) parts.push(`$expand=${encodeURIComponent(expand)}`)
  if (select) parts.push(`$select=${encodeURIComponent(select)}`)
  return `/${sapEntity}${key}${parts.length ? "?" + parts.join("&") : ""}`
}

function buildODataUrl(entityKey: string, query: Record<string, string>): string {
  const parts: string[] = []
  const top = Math.min(parseInt(query.top ?? "50", 10) || 50, 500)
  parts.push(`$top=${top}`)
  if (query.skip) parts.push(`$skip=${query.skip}`)
  const cfg = ENTITY_MAP[entityKey]
  const filters: string[] = []
  if (cfg?.defaultFilter) filters.push(cfg.defaultFilter)
  if (query.filter) filters.push(query.filter)
  if (filters.length) parts.push(`$filter=${encodeURIComponent(filters.join(" and "))}`)
  const select = query.select || cfg?.selectDefault
  if (select) parts.push(`$select=${encodeURIComponent(select)}`)
  if (query.orderby) parts.push(`$orderby=${encodeURIComponent(query.orderby)}`)
  if (query.expand) parts.push(`$expand=${encodeURIComponent(query.expand)}`)
  const sapEntity = cfg?.sapEntity ?? entityKey
  return `/${sapEntity}?${parts.join("&")}`
}

// ── Keywords para selección de modelo ────────────────────────────
const complexReportKeywords = [
  "reporte","informe","kpi","comparar","facturacion","facturado",
  "mensual","semanal","semana","trimestre","evolucion","crecimiento",
  "ventas","compras","contabilidad","asiento","grafico","dashboard",
  "top","sql","query","analizar","analisis","consolidado","balance",
  "hacer","crear","actualizar","modificar",
  "margen","rentabilidad","porcentaje","ticket","conversion",
  "vencido","cartera","cobros","pareto","historial",
]

// ── CORE_TABLES pre-registradas ──────────────────────────────────
const CORE_TABLES = [
  "OINV","INV1","OITM","OITB","OCRD","OSLP","ORCT","RCT2",
  "ORDR","RDR1","OQUT","QUT1","OPOR","POR1","OIGN","IGN1","OWOR","WOR1",
]

// Suppress unused variable warnings — these are used by tools added in Tasks 6-12
void classifySapError
void buildDocUrl
void buildODataUrl

// ── Handler principal ────────────────────────────────────────────
export async function POST(req: Request) {
  const [tenantId, apiKey] = await Promise.all([getTenantId(), getApiKey()])
  if (!tenantId || !apiKey) {
    return Response.json({ error: "Sesión no válida. Accede desde Mission Control." }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  if (!body || !Array.isArray(body.messages)) {
    return Response.json({ error: "Body inválido. Se esperaba { messages: [...] }" }, { status: 400 })
  }

  const client = new BackendClient(tenantId, apiKey)

  // Model selection
  const lastUserMsg = [...(body.messages as ModelMessage[])].reverse().find((m) => m.role === "user")
  const userText = lastUserMsg?.content ? String(lastUserMsg.content) : ""
  const userTextNorm = userText.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  const isComplexQuery = complexReportKeywords.some((kw) => userTextNorm.includes(kw))

  const requestedModel = typeof body.model === "string" ? body.model : ""
  const selectedModel: AllowedModel = ALLOWED_MODELS.includes(requestedModel as AllowedModel)
    ? (requestedModel as AllowedModel)
    : DEFAULT_MODEL
  const modelCfg = MODEL_CONFIGS[selectedModel]
  const maxSteps = isComplexQuery ? 20 : 12

  // Message pruning (no sessions — historial viene del cliente)
  const pruned = pruneMessages({
    messages: body.messages as ModelMessage[],
    reasoning: "before-last-message",
    toolCalls: "before-last-3-messages",
    emptyMessages: "remove",
  })
  const allMessages = pruned.length > 60 ? pruned.slice(pruned.length - 60) : pruned

  // discoveredTables — estado por request
  const discoveredTables = new Set<string>(CORE_TABLES)

  // Anthropic key per tenant
  const anthropicKey =
    process.env[`${tenantId.toUpperCase()}_ANTHROPIC_API_KEY`] ??
    process.env.ANTHROPIC_API_KEY ??
    ""

  const anthropic = createAnthropic({ apiKey: anthropicKey })

  let writer!: UIMessageStreamWriter

  const stream = createUIMessageStream({
    execute: async (ctx) => {
      writer = ctx.writer
      writer.write({ type: "data-status", data: { text: "Conectando a SAP B1…" } } as never)
      const sapCtx = await fetchSapContext(client, tenantId)
      writer.write({ type: "data-status", data: { text: "Analizando tu consulta…" } } as never)

      const result = streamText({
        model: anthropic(toApiSlug(selectedModel)),
        system: [
          { role: "system" as const, content: buildStaticSystemPrompt(tenantId) },
          { role: "system" as const, content: buildDynamicSystemContext(tenantId, sapCtx) },
        ],
        messages: allMessages,
        stopWhen: stepCountIs(maxSteps),
        providerOptions: {
          anthropic: {
            ...(modelCfg.thinking ? { thinking: modelCfg.thinking } : {}),
            ...(modelCfg.effort ? { effort: modelCfg.effort } : {}),
            cacheControl: { type: "ephemeral" },
          },
        },
        tools: {
          // Tools added in Tasks 6-12
        },
      })

      for await (const chunk of result.toUIMessageStream({ sendReasoning: true })) {
        writer.write(chunk)
      }
    },
  })

  // Suppress unused variable warnings — used by tools added in Tasks 6-12
  void client
  void discoveredTables

  return createUIMessageStreamResponse({ stream })
}
