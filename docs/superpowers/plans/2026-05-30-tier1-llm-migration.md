# Tier 1: LLM Migration — Backend → sap-b1-chat

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mover toda la lógica LLM (Anthropic, 47 tools, system prompt) del backend SAP al repo del chat, dejando el backend como API de datos pura.

**Architecture:** El backend recibe 3 nuevos endpoints pequeños (schema discovery, OData read proxy, SAP write proxy). El chat recibe BackendClient tipado + todo el route LLM reescrito con HTTP calls al backend en vez de llamadas directas a SAP. Las sessions se eliminan — el historial vive en el cliente.

**Tech Stack:** Next.js 15, AI SDK v6 (`ai`, `@ai-sdk/anthropic`), Zod, `@ai4u/mc-sso` (auth ya existente).

**Repos:**
- Backend: `/home/ai_tamaprint/Software/clients/AI4U/experiments/superAI/sap-b1-backend`
- Chat: `/home/ai_tamaprint/Software/clients/AI4U/experiments/superAI/sap-b1-chat`

---

## File Map

### sap-b1-backend (modificaciones pequeñas)
| Archivo | Acción |
|---------|--------|
| `app/api/v1/[tenant]/schema/route.ts` | Crear — wrappea buscarMetadatoTabla |
| `app/api/v1/[tenant]/odata/route.ts` | Crear — proxy OData GET al SAP |
| `app/api/v1/[tenant]/sap-write/route.ts` | Crear — proxy POST/PATCH/action al SAP |

### sap-b1-chat (el trabajo principal)
| Archivo | Acción |
|---------|--------|
| `package.json` | Modificar — añadir `@ai-sdk/anthropic` y `zod` |
| `lib/backend-client.ts` | Crear — cliente HTTP tipado para el backend |
| `lib/entity-map.ts` | Crear — copia de ENTITY_MAP del backend |
| `lib/chat/system-prompt.ts` | Crear — copia desde backend (sin cambios) |
| `lib/chat/tenant-profiles.ts` | Crear — copia desde backend (sin cambios) |
| `lib/chat/sap-context.ts` | Crear — reescrito para usar BackendClient |
| `app/api/chat/route.ts` | Reemplazar — de proxy thin a LLM completo |

---

## Task 1: Backend — endpoint de schema discovery

**Repo:** `sap-b1-backend`

**Files:**
- Create: `app/api/v1/[tenant]/schema/route.ts`

- [ ] **Step 1: Crear el archivo**

```typescript
// app/api/v1/[tenant]/schema/route.ts
import { NextRequest, NextResponse } from "next/server"
import { getAuthContext, unauthorized } from "@/lib/auth"
import { TENANT_IDS } from "@/lib/tenants"
import type { TenantId } from "@/lib/tenants"
import { buscarMetadatoTabla } from "@/lib/sap/metadata"

type Ctx = { params: Promise<{ tenant: string }> }

export async function GET(req: NextRequest, ctx: Ctx) {
  const { tenant: tenantRaw } = await ctx.params
  const tenant = TENANT_IDS.includes(tenantRaw as TenantId) ? (tenantRaw as TenantId) : null
  if (!tenant) return NextResponse.json({ error: "Tenant inválido" }, { status: 400 })

  const auth = getAuthContext(req, tenant)
  if (!auth) return unauthorized()

  const q = req.nextUrl.searchParams.get("q") ?? ""
  if (!q) return NextResponse.json({ error: "Param 'q' requerido" }, { status: 400 })

  const resultados = buscarMetadatoTabla(q)
  return NextResponse.json({ resultados, count: resultados.length })
}
```

- [ ] **Step 2: Type-check**

```bash
cd /home/ai_tamaprint/Software/clients/AI4U/experiments/superAI/sap-b1-backend
npm run type-check
```
Esperado: sin errores.

- [ ] **Step 3: Commit**

```bash
git add app/api/v1/\[tenant\]/schema/route.ts
git commit -m "feat: GET /schema?q= para discovery de tablas SAP"
```

---

## Task 2: Backend — OData proxy + SAP write proxy

**Repo:** `sap-b1-backend`

**Files:**
- Create: `app/api/v1/[tenant]/odata/route.ts`
- Create: `app/api/v1/[tenant]/sap-write/route.ts`

- [ ] **Step 1: Crear el proxy OData (GET)**

```typescript
// app/api/v1/[tenant]/odata/route.ts
import { NextRequest, NextResponse } from "next/server"
import { getAuthContext, unauthorized } from "@/lib/auth"
import { getSapConfig, TENANT_IDS } from "@/lib/tenants"
import type { TenantId } from "@/lib/tenants"
import { sapGet } from "@/lib/sap/client"

type Ctx = { params: Promise<{ tenant: string }> }

export async function GET(req: NextRequest, ctx: Ctx) {
  const { tenant: tenantRaw } = await ctx.params
  const tenant = TENANT_IDS.includes(tenantRaw as TenantId) ? (tenantRaw as TenantId) : null
  if (!tenant) return NextResponse.json({ error: "Tenant inválido" }, { status: 400 })

  const auth = getAuthContext(req, tenant)
  if (!auth) return unauthorized()

  const path = req.nextUrl.searchParams.get("path") ?? ""
  if (!path || !path.startsWith("/")) {
    return NextResponse.json({ error: "Param 'path' requerido (debe comenzar con /)" }, { status: 400 })
  }

  try {
    const cfg = getSapConfig(auth.tenant)
    const data = await sapGet<unknown>(cfg, path)
    return NextResponse.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error SAP"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
```

- [ ] **Step 2: Crear el proxy de escritura SAP**

```typescript
// app/api/v1/[tenant]/sap-write/route.ts
import { NextRequest, NextResponse } from "next/server"
import { getAuthContext, unauthorized } from "@/lib/auth"
import { getSapConfig, TENANT_IDS } from "@/lib/tenants"
import type { TenantId } from "@/lib/tenants"
import { sapPost, sapPatch, sapAction } from "@/lib/sap/client"
import { logger, newRequestId } from "@/lib/logger"

type Ctx = { params: Promise<{ tenant: string }> }

export async function POST(req: NextRequest, ctx: Ctx) {
  const { tenant: tenantRaw } = await ctx.params
  const tenant = TENANT_IDS.includes(tenantRaw as TenantId) ? (tenantRaw as TenantId) : null
  if (!tenant) return NextResponse.json({ error: "Tenant inválido" }, { status: 400 })

  const auth = getAuthContext(req, tenant)
  if (!auth) return unauthorized()

  const reqId = newRequestId()

  let body: { method?: string; path?: string; body?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 })
  }

  const { method = "POST", path, body: payload } = body
  if (!path || !path.startsWith("/")) {
    return NextResponse.json({ error: "Campo 'path' requerido (debe comenzar con /)" }, { status: 400 })
  }
  if (!["POST", "PATCH", "ACTION"].includes(method)) {
    return NextResponse.json({ error: "method debe ser POST, PATCH o ACTION" }, { status: 400 })
  }

  try {
    const cfg = getSapConfig(auth.tenant)
    logger.warn({ reqId, tenant: auth.tenant, method, path }, "SAP WRITE via sap-write proxy")

    if (method === "PATCH") {
      await sapPatch(cfg, path, payload ?? {})
      return NextResponse.json({ ok: true })
    }
    if (method === "ACTION") {
      const result = await sapAction<unknown>(cfg, path)
      return NextResponse.json({ result })
    }
    // POST
    const result = await sapPost<unknown>(cfg, path, payload ?? {})
    return NextResponse.json({ result })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error SAP"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
```

- [ ] **Step 3: Type-check**

```bash
npm run type-check
```
Esperado: sin errores.

- [ ] **Step 4: Commit**

```bash
git add app/api/v1/\[tenant\]/odata/route.ts app/api/v1/\[tenant\]/sap-write/route.ts
git commit -m "feat: proxy OData GET y SAP write proxy para el chat"
git push
```

---

## Task 3: Chat — dependencias + BackendClient + EntityMap

**Repo:** `sap-b1-chat`

**Files:**
- Modify: `package.json`
- Create: `lib/backend-client.ts`
- Create: `lib/entity-map.ts`

- [ ] **Step 1: Instalar dependencias**

```bash
cd /home/ai_tamaprint/Software/clients/AI4U/experiments/superAI/sap-b1-chat
npm install @ai-sdk/anthropic zod
```

- [ ] **Step 2: Crear `lib/backend-client.ts`**

```typescript
// lib/backend-client.ts
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:4100"

export class BackendClient {
  private base: string
  readonly tenant: string
  private apiKey: string

  constructor(tenant: string, apiKey: string) {
    this.tenant = tenant
    this.apiKey = apiKey
    this.base = `${BACKEND_URL}/api/v1/${tenant}`
  }

  private headers(): HeadersInit {
    return { "Content-Type": "application/json", "X-API-Key": this.apiKey }
  }

  async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      headers: this.headers(),
      cache: "no-store",
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`Backend GET ${path} (${res.status}): ${text}`)
    }
    return res.json() as Promise<T>
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      cache: "no-store",
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`Backend POST ${path} (${res.status}): ${text}`)
    }
    return res.json() as Promise<T>
  }

  async patch(path: string, body: unknown): Promise<void> {
    const res = await fetch(`${this.base}${path}`, {
      method: "PATCH",
      headers: this.headers(),
      body: JSON.stringify(body),
      cache: "no-store",
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`Backend PATCH ${path} (${res.status}): ${text}`)
    }
  }

  /** GET /schema?q= */
  schema(q: string) {
    return this.get<{ resultados: unknown[]; count: number }>(
      `/schema?q=${encodeURIComponent(q)}`
    )
  }

  /** GET /odata?path= — proxy SAP OData */
  odata<T>(odataPath: string) {
    return this.get<T>(`/odata?path=${encodeURIComponent(odataPath)}`)
  }

  /** POST /query */
  sapQuery(sql: string, limit = 500) {
    return this.post<{ rows: unknown[]; count: number }>("/query", { sql, limit })
  }

  /** GET /query/catalog */
  catalogList() {
    return this.get<{ queries: Array<{ name: string; description: string; params: string[] }> }>(
      "/query/catalog"
    )
  }

  /** POST /query/catalog */
  catalogQuery(name: string, params?: unknown, limit?: number) {
    return this.post<{ rows: unknown[]; count: number; query: string }>("/query/catalog", {
      query: name,
      params,
      limit,
    })
  }

  /** POST /sap-write — proxy para escrituras SAP genéricas */
  sapWrite<T = unknown>(method: "POST" | "PATCH" | "ACTION", path: string, body?: unknown) {
    return this.post<{ result?: T; ok?: boolean }>("/sap-write", { method, path, body })
  }
}
```

- [ ] **Step 3: Crear `lib/entity-map.ts`**

Copiar el contenido completo de `lib/sap/entities.ts` del backend, cambiando SOLO el path de los imports de schemas. Los schemas de Zod son opcionales para el chat (solo se usan en `crear_documento`/`actualizar_documento` para validación). Crear el archivo con esta estructura simplificada (sin imports de schemas, sin `schema`/`patchSchema` fields que no se usan en el chat):

```typescript
// lib/entity-map.ts
// Copia de lib/sap/entities.ts del backend — solo campos usados por el chat
export interface EntityConfig {
  sapEntity: string
  keyType?: "number" | "string"
  defaultFilter?: string
  allowedActions?: string[]
  selectDefault?: string
}

const DOC_ACTIONS = ["Cancel", "Close", "Reopen"]

export const ENTITY_MAP: Record<string, EntityConfig> = {
  // ── COMPRAS ──────────────────────────────────────────────────
  "compras/ordenes": { sapEntity: "PurchaseOrders", keyType: "number", allowedActions: DOC_ACTIONS, selectDefault: "DocEntry,DocNum,CardCode,CardName,DocDate,DocDueDate,DocTotal,DocumentStatus,Comments" },
  "compras/facturas": { sapEntity: "PurchaseInvoices", keyType: "number", allowedActions: ["Cancel"], selectDefault: "DocEntry,DocNum,CardCode,CardName,DocDate,DocDueDate,DocTotal,DocumentStatus" },
  "compras/notas-credito": { sapEntity: "PurchaseCreditNotes", keyType: "number", allowedActions: ["Cancel"], selectDefault: "DocEntry,DocNum,CardCode,CardName,DocDate,DocTotal,DocumentStatus" },
  "compras/entregas": { sapEntity: "PurchaseDeliveryNotes", keyType: "number", allowedActions: ["Cancel", "Close"], selectDefault: "DocEntry,DocNum,CardCode,CardName,DocDate,DocTotal,DocumentStatus" },
  "compras/devoluciones": { sapEntity: "PurchaseReturns", keyType: "number", selectDefault: "DocEntry,DocNum,CardCode,CardName,DocDate,DocTotal,DocumentStatus" },
  "compras/cotizaciones": { sapEntity: "PurchaseQuotations", keyType: "number", allowedActions: ["Cancel", "Close"], selectDefault: "DocEntry,DocNum,CardCode,CardName,DocDate,DocDueDate,DocTotal,DocumentStatus" },
  "compras/solicitudes": { sapEntity: "PurchaseRequests", keyType: "number", allowedActions: ["Cancel", "Close"], selectDefault: "DocEntry,DocNum,CardCode,CardName,DocDate,DocDueDate,DocumentStatus" },
  // ── VENTAS ───────────────────────────────────────────────────
  "ventas/pedidos": { sapEntity: "Orders", keyType: "number", allowedActions: DOC_ACTIONS, selectDefault: "DocEntry,DocNum,CardCode,CardName,DocDate,DocDueDate,DocTotal,DocumentStatus,Comments" },
  "ventas/facturas": { sapEntity: "Invoices", keyType: "number", allowedActions: ["Cancel"], selectDefault: "DocEntry,DocNum,CardCode,CardName,DocDate,DocDueDate,DocTotal,DocumentStatus" },
  "ventas/notas-credito": { sapEntity: "CreditNotes", keyType: "number", allowedActions: ["Cancel"], selectDefault: "DocEntry,DocNum,CardCode,CardName,DocDate,DocTotal,DocumentStatus" },
  "ventas/entregas": { sapEntity: "DeliveryNotes", keyType: "number", allowedActions: ["Cancel", "Close"], selectDefault: "DocEntry,DocNum,CardCode,CardName,DocDate,DocTotal,DocumentStatus" },
  "ventas/devoluciones": { sapEntity: "Returns", keyType: "number", selectDefault: "DocEntry,DocNum,CardCode,CardName,DocDate,DocTotal,DocumentStatus" },
  "ventas/cotizaciones": { sapEntity: "Quotations", keyType: "number", allowedActions: DOC_ACTIONS, selectDefault: "DocEntry,DocNum,CardCode,CardName,DocDate,DocDueDate,DocTotal,DocumentStatus" },
  "ventas/anticipos": { sapEntity: "DownPayments", keyType: "number", allowedActions: ["Cancel"], selectDefault: "DocEntry,DocNum,CardCode,CardName,DocDate,DocTotal,DocumentStatus" },
  // ── INVENTARIO ───────────────────────────────────────────────
  "inventario/items": { sapEntity: "Items", keyType: "string", selectDefault: "ItemCode,ItemName,QuantityOnStock,AvgStdPrice,ItemsGroupCode,frozenFor" },
  "inventario/transferencias": { sapEntity: "StockTransfers", keyType: "number", allowedActions: ["Cancel"], selectDefault: "DocEntry,DocNum,FromWarehouse,ToWarehouse,DocDate,DocumentStatus" },
  "inventario/entradas": { sapEntity: "InventoryGenEntries", keyType: "number", allowedActions: ["Cancel"], selectDefault: "DocEntry,DocNum,DocDate,DocTotal,DocumentStatus,Comments" },
  "inventario/salidas": { sapEntity: "InventoryGenExits", keyType: "number", allowedActions: ["Cancel"], selectDefault: "DocEntry,DocNum,DocDate,DocTotal,DocumentStatus,Comments" },
  "inventario/almacenes": { sapEntity: "Warehouses", keyType: "string", selectDefault: "WarehouseCode,WarehouseName,Location" },
  // ── SOCIOS ───────────────────────────────────────────────────
  "socios/clientes": { sapEntity: "BusinessPartners", keyType: "string", defaultFilter: "CardType eq 'cCustomer'", selectDefault: "CardCode,CardName,Phone1,EmailAddress,CurrentAccountBalance,CreditLimit" },
  "socios/proveedores": { sapEntity: "BusinessPartners", keyType: "string", defaultFilter: "CardType eq 'cSupplier'", selectDefault: "CardCode,CardName,Phone1,EmailAddress,CurrentAccountBalance" },
  "socios/todos": { sapEntity: "BusinessPartners", keyType: "string", selectDefault: "CardCode,CardName,CardType,Phone1,EmailAddress,CurrentAccountBalance" },
  // ── PAGOS ────────────────────────────────────────────────────
  "pagos/cobros": { sapEntity: "IncomingPayments", keyType: "number", allowedActions: ["Cancel"], selectDefault: "DocEntry,DocNum,CardCode,CardName,DocDate,DocTotal,CashSum,TrsfrSum,CheckSum" },
  "pagos/pagos": { sapEntity: "VendorPayments", keyType: "number", allowedActions: ["Cancel"], selectDefault: "DocEntry,DocNum,CardCode,CardName,DocDate,DocTotal" },
  // ── CONTABILIDAD ─────────────────────────────────────────────
  "contabilidad/asientos": { sapEntity: "JournalEntries", keyType: "number", selectDefault: "JdtNum,RefDate,Memo,Debit,Credit" },
  "contabilidad/cuentas": { sapEntity: "ChartOfAccounts", keyType: "string", selectDefault: "Code,Name,AccountType,ActiveAccount" },
  // ── PRODUCCIÓN ───────────────────────────────────────────────
  "produccion/ordenes": { sapEntity: "ProductionOrders", keyType: "number", allowedActions: ["Cancel", "Close"], selectDefault: "DocEntry,ItemCode,PlannedQty,CmpltQty,DueDate,Status" },
  "produccion/bom": { sapEntity: "ProductionOrders", keyType: "number", selectDefault: "DocEntry,ItemCode,PlannedQty,Status" },
  // ── RRHH ─────────────────────────────────────────────────────
  "rrhh/empleados": { sapEntity: "EmployeesInfo", keyType: "number", selectDefault: "EmployeeID,FirstName,LastName,Department,Position,Active" },
}
```

- [ ] **Step 4: Type-check**

```bash
npm run type-check
```
Esperado: sin errores.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json lib/backend-client.ts lib/entity-map.ts
git commit -m "feat: BackendClient tipado + EntityMap para el chat LLM"
```

---

## Task 4: Chat — lib/chat files (system-prompt, tenant-profiles, sap-context)

**Repo:** `sap-b1-chat`

**Files:**
- Create: `lib/chat/system-prompt.ts` — copia desde backend
- Create: `lib/chat/tenant-profiles.ts` — copia desde backend
- Create: `lib/chat/sap-context.ts` — reescrito para BackendClient

- [ ] **Step 1: Crear directorio y copiar archivos estáticos**

```bash
mkdir -p /home/ai_tamaprint/Software/clients/AI4U/experiments/superAI/sap-b1-chat/lib/chat
```

Copiar `lib/chat/system-prompt.ts` del backend al chat. Cambiar SOLO el import de TenantId:

```typescript
// lib/chat/system-prompt.ts
// Pegar el contenido completo de:
// /home/ai_tamaprint/Software/clients/AI4U/experiments/superAI/sap-b1-backend/lib/chat/system-prompt.ts
//
// Cambiar ÚNICAMENTE la primera línea de import:
// DE:  import type { TenantId } from "@/lib/tenants"
// A:   export type TenantId = string
//
// Y la segunda línea:
// DE:  import { getTenantProfile } from "./tenant-profiles"
// A:   import { getTenantProfile } from "./tenant-profiles"   ← sin cambio
//
// Y el import de SapContext:
// DE:  import type { SapContext } from "./sap-context"
// A:   import type { SapContext } from "./sap-context"         ← sin cambio
```

Copiar `lib/chat/tenant-profiles.ts` del backend al chat sin ningún cambio (es puro static data, no tiene imports de lib interna).

- [ ] **Step 2: Crear `lib/chat/sap-context.ts` (reescrito)**

```typescript
// lib/chat/sap-context.ts
import type { BackendClient } from "@/lib/backend-client"

export interface Warehouse { code: string; name: string }
export interface SalesPerson { code: number; name: string }
export interface CostCenter { code: string; name: string }
export interface ItemGroup { code: number; name: string }
export interface CustomField { table: string; fieldId: string; name: string; description: string }

export interface SapContext {
  almacenes: Warehouse[]
  vendedores: SalesPerson[]
  centrosCosto: CostCenter[]
  gruposItem: ItemGroup[]
  camposPersonalizados: CustomField[]
}

const EMPTY: SapContext = {
  almacenes: [],
  vendedores: [],
  centrosCosto: [],
  gruposItem: [],
  camposPersonalizados: [],
}

const RELEVANT_TABLES = [
  "OINV","INV1","ORDR","RDR1","OPOR","POR1","OPCH","PCH1","OPDN","PDN1",
  "OITM","OCRD","ORCT","OJDT",
]

interface CacheEntry { context: SapContext; expiresAt: number }
const cache = new Map<string, CacheEntry>()
const TTL_MS = 60 * 60 * 1000

async function safeGet<T>(client: BackendClient, path: string): Promise<T[]> {
  try {
    const res = await client.get<{ value?: T[] }>(path)
    return res.value ?? []
  } catch {
    return []
  }
}

export async function fetchSapContext(client: BackendClient, tenant: string): Promise<SapContext> {
  const cached = cache.get(tenant)
  if (cached && cached.expiresAt > Date.now()) return cached.context

  const tablesFilter = RELEVANT_TABLES.map((t) => `TableName eq '${t}'`).join(" or ")

  const [rawWh, rawSlp, rawCC, rawIG, rawCF] = await Promise.all([
    safeGet<{ WarehouseCode: string; WarehouseName: string }>(
      client, `/odata?path=${encodeURIComponent("/Warehouses?$select=WarehouseCode,WarehouseName&$top=200")}`
    ),
    safeGet<{ SalesEmployeeCode: number; SalesEmployeeName: string }>(
      client, `/odata?path=${encodeURIComponent("/SalesPersons?$select=SalesEmployeeCode,SalesEmployeeName&$top=200")}`
    ),
    safeGet<{ CenterCode: string; CenterName: string }>(
      client, `/odata?path=${encodeURIComponent("/ProfitCenters?$select=CenterCode,CenterName&$top=200")}`
    ),
    safeGet<{ Number: number; GroupName: string }>(
      client, `/odata?path=${encodeURIComponent("/ItemGroups?$select=Number,GroupName&$top=200")}`
    ),
    safeGet<{ TableName: string; FieldID: string; Name: string; Description: string }>(
      client, `/odata?path=${encodeURIComponent(`/UserFieldsMD?$select=TableName,FieldID,Name,Description&$filter=${tablesFilter}&$top=500`)}`
    ),
  ])

  const context: SapContext = {
    almacenes: rawWh.map((w) => ({ code: w.WarehouseCode, name: w.WarehouseName })),
    vendedores: rawSlp.filter((s) => s.SalesEmployeeCode > 0).map((s) => ({ code: s.SalesEmployeeCode, name: s.SalesEmployeeName })),
    centrosCosto: rawCC.map((c) => ({ code: c.CenterCode, name: c.CenterName })),
    gruposItem: rawIG.map((g) => ({ code: g.Number, name: g.GroupName })),
    camposPersonalizados: rawCF
      .filter((f) => f.FieldID && f.TableName)
      .reduce<CustomField[]>((acc, f) => {
        if (acc.filter((x) => x.table === f.TableName).length >= 40) return acc
        acc.push({ table: f.TableName, fieldId: `U_${f.FieldID}`, name: f.Name ?? f.FieldID, description: f.Description ?? "" })
        return acc
      }, []),
  }

  cache.set(tenant, { context, expiresAt: Date.now() + TTL_MS })
  return context
}
```

- [ ] **Step 3: Type-check**

```bash
npm run type-check
```

- [ ] **Step 4: Commit**

```bash
git add lib/chat/
git commit -m "feat: lib/chat — system-prompt, tenant-profiles, sap-context con BackendClient"
```

---

## Task 5: Chat — route scaffold (estructura base sin tools)

**Repo:** `sap-b1-chat`

**Files:**
- Modify: `app/api/chat/route.ts` — reemplazar proxy con scaffold LLM

- [ ] **Step 1: Reemplazar `app/api/chat/route.ts` con el scaffold**

```typescript
// app/api/chat/route.ts
import { createAnthropic } from "@ai-sdk/anthropic"
import {
  streamText, tool, stepCountIs, pruneMessages,
  createUIMessageStream, createUIMessageStreamResponse,
} from "ai"
import type { ModelMessage, UIMessageStreamWriter } from "ai"
import { z } from "zod"
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

// ── OData URL builders (idénticos al backend) ────────────────────
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

// ── Tabla de keywords para selección de modelo ───────────────────
const complexReportKeywords = [
  "reporte","informe","kpi","comparar","facturacion","facturado",
  "mensual","semanal","semana","trimestre","evolucion","crecimiento",
  "ventas","compras","contabilidad","asiento","grafico","dashboard",
  "top","sql","query","analizar","analisis","consolidado","balance",
  "hacer","crear","actualizar","modificar",
  "margen","rentabilidad","porcentaje","ticket","conversion",
  "vencido","cartera","cobros","pareto","historial",
]

// ── CORE_TABLES pre-registradas para validación SQL ─────────────
const CORE_TABLES = [
  "OINV","INV1","OITM","OITB","OCRD","OSLP","ORCT","RCT2",
  "ORDR","RDR1","OQUT","QUT1","OPOR","POR1","OIGN","IGN1","OWOR","WOR1",
]

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

  // Message pruning (sin sessions — historial viene del cliente)
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
          // Tools se añaden en Tasks 6-12
        },
      })

      for await (const chunk of result.toUIMessageStream({ sendReasoning: true })) {
        writer.write(chunk)
      }
    },
  })

  return createUIMessageStreamResponse({ stream })
}
```

- [ ] **Step 2: Type-check**

```bash
npm run type-check
```
Esperado: sin errores (el objeto `tools: {}` vacío es válido).

- [ ] **Step 3: Test rápido — el servidor arranca**

```bash
npm run dev &
sleep 3
curl -s http://localhost:4101/api/chat -X POST \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hola"}]}' | head -c 100
```
Esperado: `{"error":"Sesión no válida..."}` (sin API key en cookie, correcto).

```bash
kill %1
```

- [ ] **Step 4: Commit**

```bash
git add app/api/chat/route.ts
git commit -m "feat: chat route scaffold — LLM setup sin tools aún"
```

---

## Task 6: Chat — tools de schema, SQL y catálogo (5 tools)

**Repo:** `sap-b1-chat`

**Files:**
- Modify: `app/api/chat/route.ts` — añadir 5 tools al objeto `tools:`

Abrir `app/api/chat/route.ts` y reemplazar `tools: {  // Tools se añaden en Tasks 6-12  }` con los 5 primeros tools:

- [ ] **Step 1: Añadir los 5 tools**

```typescript
tools: {
  descubrir_esquema: tool({
    description:
      "Busca la estructura de tablas del ERP: columnas, tipos de datos y descripciones. Úsalo SIEMPRE antes de formular o corregir cualquier consulta SQL para asegurar nombres de campos y tablas correctos.",
    inputSchema: z.object({
      terminoBusqueda: z.string().describe("Nombre de la tabla (ej: 'OINV') o concepto (ej: 'cliente', 'factura')"),
    }),
    execute: async ({ terminoBusqueda }: { terminoBusqueda: string }, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: `Buscando esquema de '${terminoBusqueda}'…` } } as never)
      try {
        const result = await client.schema(terminoBusqueda)
        discoveredTables.add(terminoBusqueda.trim().toUpperCase())
        for (const r of result.resultados as Array<{ tabla?: string }>) {
          if (r.tabla) discoveredTables.add(r.tabla.toUpperCase())
        }
        return result
      } catch (err) {
        return classifySapError(err)
      }
    },
  }),

  consultar_sql: tool({
    description:
      "Ejecuta una consulta SQL SELECT en SAP Business One. Usa sintaxis SAP HANA. Solo lectura — no ejecutes INSERT, UPDATE, DELETE ni DROP.",
    inputSchema: z.object({
      sql: z.string().describe("Sentencia SQL SELECT en sintaxis HANA"),
    }),
    execute: async ({ sql }: { sql: string }, { toolCallId }) => {
      if (!sql.trim().toUpperCase().startsWith("SELECT")) {
        return { error: { code: "INVALID_QUERY", message: "Solo se permiten consultas SELECT.", retryable: false } }
      }
      const SQL_KEYWORDS = new Set([
        "ORDER","OUTER","UNION","OVER","OFFSET","ONLY","INNER","CROSS",
        "GROUP","HAVING","WHERE","FROM","INTO","JOIN","LEFT","RIGHT","FULL","WITH",
      ])
      const tableMatches = sql.match(/\b(O[A-Z]{3,4}|[A-Z]{3}\d)\b/gi) ?? []
      const tablesInQuery = Array.from(new Set(tableMatches.map((t) => t.toUpperCase()).filter((t) => !SQL_KEYWORDS.has(t))))
      const undiscovered = tablesInQuery.filter((t) => !discoveredTables.has(t))
      if (undiscovered.length > 0) {
        return {
          error: {
            code: "SCHEMA_NOT_DISCOVERED",
            message: `Antes de consultar [${undiscovered.join(", ")}], usa 'descubrir_esquema' para verificar su estructura.`,
            retryable: true,
          },
        }
      }
      writer.write({ type: "data-tool-status", data: { toolCallId, text: "Ejecutando consulta SQL en SAP…" } } as never)
      try {
        const result = await client.sapQuery(sql)
        writer.write({ type: "data-tool-status", data: { toolCallId, text: `${result.count} registros procesados` } } as never)
        if (result.rows.length > 50) {
          return {
            rows: result.rows.slice(0, 20),
            count: result.count,
            truncated: true,
            nota: `Se recibieron ${result.count} registros. Se muestran los primeros 20. Añade TOP N o refina el filtro.`,
          }
        }
        return { rows: result.rows, count: result.count }
      } catch (err) {
        return classifySapError(err)
      }
    },
  }),

  ejecutar_query_catalogo: tool({
    description:
      "Ejecuta una query estándar del catálogo por nombre. Más seguro y rápido que consultar_sql para las 13 queries predefinidas. " +
      "Disponibles: ventas_por_periodo, top_clientes_por_facturacion, ventas_por_vendedor, " +
      "facturas_vencidas, aging_clientes, cobros_del_periodo, compras_por_proveedor, " +
      "pedidos_retrasados, margen_por_articulo, stock_por_almacen, items_sin_movimiento, " +
      "ops_abiertas, clientes_inactivos.",
    inputSchema: z.object({
      query: z.string().describe("Nombre exacto de la query del catálogo"),
      params: z.record(z.string(), z.unknown()).optional().describe("Parámetros de la query"),
      limit: z.number().int().min(1).max(5000).optional().describe("Máximo de filas (usa defaultLimit del catálogo si no se especifica)"),
    }),
    execute: async ({ query, params, limit }: { query: string; params?: Record<string, unknown>; limit?: number }, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: `Ejecutando query '${query}'…` } } as never)
      try {
        const result = await client.catalogQuery(query, params, limit)
        writer.write({ type: "data-tool-status", data: { toolCallId, text: `${result.count} registros` } } as never)
        if (result.rows.length > 50) {
          return {
            rows: result.rows.slice(0, 30),
            count: result.count,
            truncated: true,
            nota: `Se recibieron ${result.count} registros. Se muestran los primeros 30. Usa limit o parámetros de fecha para acotar.`,
          }
        }
        return { rows: result.rows, count: result.count }
      } catch (err) {
        return classifySapError(err)
      }
    },
  }),

  listar_queries_catalogo: tool({
    description:
      "Lista todas las queries disponibles en el catálogo con sus parámetros. " +
      "Llamar cuando el usuario pregunte qué consultas están disponibles.",
    inputSchema: z.object({}),
    execute: async (_args: Record<string, never>, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: "Cargando catálogo de queries…" } } as never)
      try {
        return await client.catalogList()
      } catch (err) {
        return classifySapError(err)
      }
    },
  }),

  // (continúa en Task 7...)
},
```

- [ ] **Step 2: Type-check**

```bash
npm run type-check
```

- [ ] **Step 3: Commit**

```bash
git add app/api/chat/route.ts
git commit -m "feat: tools schema/SQL/catálogo en el chat (5 tools)"
```

---

## Task 7: Chat — tools OData genéricos (3 tools)

**Repo:** `sap-b1-chat`

**Files:**
- Modify: `app/api/chat/route.ts` — añadir 3 tools OData

Insertar estos tools después del bloque de `listar_queries_catalogo` en el objeto `tools:`:

- [ ] **Step 1: Añadir 3 tools OData**

```typescript
  obtener_documento: tool({
    description:
      "Obtiene el detalle completo de un documento de negocio por su ID. Incluye líneas si se pasa expand='DocumentLines'. " +
      "Dominios: ventas/pedidos, ventas/facturas, compras/ordenes, inventario/items, socios/clientes, socios/proveedores.",
    inputSchema: z.object({
      endpoint: z.string().describe("Dominio sin tenant. Ej: 'ventas/pedidos', 'inventario/items'"),
      id: z.string().describe("DocEntry numérico o código string"),
      expand: z.string().optional().describe("Ej: 'DocumentLines'"),
      select: z.string().optional().describe("Campos separados por coma"),
    }),
    execute: async ({ endpoint, id, expand, select }: { endpoint: string; id: string; expand?: string; select?: string }, { toolCallId }) => {
      const entityKey = endpoint.replace(/^\//, "")
      if (!ENTITY_MAP[entityKey]) {
        return { error: { code: "INVALID_ENDPOINT", message: `Endpoint '${endpoint}' no reconocido. Válidos: ${Object.keys(ENTITY_MAP).join(", ")}`, retryable: false } }
      }
      writer.write({ type: "data-tool-status", data: { toolCallId, text: `Obteniendo documento ${id}…` } } as never)
      try {
        const odataPath = buildDocUrl(entityKey, id, expand, select)
        const data = await client.odata<unknown>(odataPath)
        return { document: data }
      } catch (err) {
        return classifySapError(err)
      }
    },
  }),

  listar_registros: tool({
    description:
      "Lista documentos de negocio con filtros: pedidos, facturas, órdenes de compra, clientes, inventario. " +
      "Dominios: ventas/pedidos, ventas/facturas, ventas/cotizaciones, compras/ordenes, inventario/items, socios/clientes, socios/proveedores, pagos/cobros.",
    inputSchema: z.object({
      endpoint: z.string().describe("Ruta sin tenant. Ej: 'ventas/facturas'"),
      filter: z.string().optional().describe("Filtro OData. Ej: \"DocDate ge '2026-05-01'\""),
      select: z.string().optional(),
      top: z.string().optional().describe("Máximo resultados (1–500, default 50)"),
      skip: z.string().optional(),
      orderby: z.string().optional(),
      expand: z.string().optional(),
    }),
    execute: async (
      { endpoint, filter, select, top, skip, orderby, expand }:
      { endpoint: string; filter?: string; select?: string; top?: string; skip?: string; orderby?: string; expand?: string },
      { toolCallId }
    ) => {
      const entityKey = endpoint.replace(/^\//, "")
      if (!ENTITY_MAP[entityKey]) {
        return { error: { code: "INVALID_ENDPOINT", message: `Endpoint '${endpoint}' no reconocido.`, retryable: false } }
      }
      const query = Object.fromEntries(
        Object.entries({ filter, select, top, skip, orderby, expand }).filter(([, v]) => v !== undefined) as [string, string][]
      )
      writer.write({ type: "data-tool-status", data: { toolCallId, text: `Consultando ${entityKey}…` } } as never)
      try {
        const odataPath = buildODataUrl(entityKey, query)
        const data = await client.odata<{ value?: unknown[] }>(odataPath)
        const rows = data.value ?? []
        writer.write({ type: "data-tool-status", data: { toolCallId, text: `${rows.length} registros encontrados` } } as never)
        return { rows, count: rows.length }
      } catch (err) {
        return classifySapError(err)
      }
    },
  }),

  buscar_socio_o_item: tool({
    description:
      "Busca clientes, proveedores o artículos por nombre o código parcial. " +
      "Preferir sobre listar_registros cuando la intención es identificar una entidad por texto.",
    inputSchema: z.object({
      tipo: z.enum(["cliente", "proveedor", "item"]).describe("Tipo de entidad"),
      texto: z.string().describe("Texto parcial a buscar"),
      top: z.number().optional().describe("Máximo resultados (default 10)"),
    }),
    execute: async ({ tipo, texto, top }: { tipo: "cliente" | "proveedor" | "item"; texto: string; top?: number }, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: `Buscando ${tipo}…` } } as never)
      const limit = Math.min(top ?? 10, 50)
      const escaped = texto.replace(/'/g, "''")
      try {
        if (tipo === "item") {
          const path = `/Items?$select=ItemCode,ItemName,AvgStdPrice,QuantityOnStock&$top=${limit}&$filter=contains(ItemCode,'${escaped}') or contains(ItemName,'${escaped}')`
          const res = await client.odata<{ value?: unknown[] }>(path)
          return { resultados: res.value ?? [], count: (res.value ?? []).length }
        }
        const cardFilter = tipo === "cliente" ? "CardType eq 'cCustomer'" : "CardType eq 'cSupplier'"
        const path = `/BusinessPartners?$select=CardCode,CardName,Phone1,EmailAddress,CurrentAccountBalance&$top=${limit}&$filter=(${cardFilter}) and (contains(CardCode,'${escaped}') or contains(CardName,'${escaped}'))`
        const res = await client.odata<{ value?: unknown[] }>(path)
        return { resultados: res.value ?? [], count: (res.value ?? []).length }
      } catch (err) {
        return classifySapError(err)
      }
    },
  }),
```

- [ ] **Step 2: Type-check y commit**

```bash
npm run type-check
git add app/api/chat/route.ts
git commit -m "feat: tools OData genéricos en el chat (3 tools)"
```

---

## Task 8: Chat — tools de clientes (6 tools)

**Repo:** `sap-b1-chat`

Insertar después del bloque de `buscar_socio_o_item`:

- [ ] **Step 1: Añadir 6 tools de clientes**

```typescript
  perfil_cliente: tool({
    description: "Perfil completo de un cliente: datos de contacto, saldo, crédito disponible, facturas vencidas, último pedido. Requiere CardCode exacto.",
    inputSchema: z.object({
      cardCode: z.string().describe("Código exacto del cliente (CardCode)"),
      modo: z.enum(["balance", "resumen_completo"]).default("resumen_completo"),
    }),
    execute: async ({ cardCode, modo }: { cardCode: string; modo: "balance" | "resumen_completo" }, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: `Consultando perfil de ${cardCode}…` } } as never)
      try {
        const path = modo === "balance" ? `/customers/${cardCode}/balance` : `/customers/${cardCode}/summary`
        const data = await client.get<unknown>(path)
        return { [modo === "balance" ? "balance" : "summary"]: data }
      } catch (err) { return classifySapError(err) }
    },
  }),

  historial_cliente: tool({
    description: "Historial de compras de un cliente: productos habituales, frecuencia y gasto total. Requiere CardCode exacto.",
    inputSchema: z.object({
      cardCode: z.string(),
      meses: z.number().int().min(1).max(36).default(12),
      topN: z.number().int().min(1).max(50).default(10),
    }),
    execute: async ({ cardCode, meses, topN }: { cardCode: string; meses: number; topN: number }, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: `Analizando historial de ${cardCode}…` } } as never)
      try {
        const data = await client.get<unknown>(`/customers/${cardCode}/history?months=${meses}&topN=${topN}`)
        return { history: data }
      } catch (err) { return classifySapError(err) }
    },
  }),

  aging_cliente: tool({
    description: "Facturas vencidas de un cliente específico con aging por tramos. Para aging global usar cartera_empresa.",
    inputSchema: z.object({ cardCode: z.string() }),
    execute: async ({ cardCode }: { cardCode: string }, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: `Consultando facturas vencidas de ${cardCode}…` } } as never)
      try {
        const data = await client.get<unknown>(`/customers/${cardCode}/aging`)
        return { aging: data }
      } catch (err) { return classifySapError(err) }
    },
  }),

  verificar_credito: tool({
    description: "Crédito de un cliente antes de crear un pedido: saldo, límite, comprometido, disponible y estado (ok/warning/blocked).",
    inputSchema: z.object({ cardCode: z.string() }),
    execute: async ({ cardCode }: { cardCode: string }, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: `Verificando crédito de ${cardCode}…` } } as never)
      try {
        const data = await client.get<unknown>(`/customers/${cardCode}/credit-check`)
        return { credit: data }
      } catch (err) { return classifySapError(err) }
    },
  }),

  pagos_cliente: tool({
    description: "Historial de pagos recibidos de un cliente: fechas, montos y forma de pago.",
    inputSchema: z.object({
      cardCode: z.string(),
      limite: z.number().int().min(1).max(200).default(50),
    }),
    execute: async ({ cardCode, limite }: { cardCode: string; limite: number }, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: `Consultando pagos de ${cardCode}…` } } as never)
      try {
        const data = await client.get<unknown>(`/customers/${cardCode}/payments?limit=${limite}`)
        return { result: data }
      } catch (err) { return classifySapError(err) }
    },
  }),

  clientes_inactivos: tool({
    description: "Clientes que no han comprado en los últimos N meses, ordenados por días sin actividad.",
    inputSchema: z.object({
      meses: z.number().int().min(1).max(24).default(3),
      limite: z.number().int().min(1).max(200).default(50),
    }),
    execute: async ({ meses, limite }: { meses: number; limite: number }, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: `Buscando clientes sin compras en ${meses} meses…` } } as never)
      try {
        const data = await client.get<unknown>(`/customers/churn?months=${meses}&limit=${limite}`)
        return { result: data }
      } catch (err) { return classifySapError(err) }
    },
  }),
```

- [ ] **Step 2: Type-check y commit**

```bash
npm run type-check
git add app/api/chat/route.ts
git commit -m "feat: tools de clientes en el chat (6 tools)"
```

---

## Task 9: Chat — tools de ventas y comercial (9 tools)

**Repo:** `sap-b1-chat`

Insertar después de `clientes_inactivos`:

- [ ] **Step 1: Añadir 9 tools de ventas y comercial**

```typescript
  pipeline_ventas: tool({
    description: "Snapshot del pipeline: cotizaciones y pedidos abiertos con montos. Opcionalmente filtrar por cardCode.",
    inputSchema: z.object({ cardCode: z.string().optional() }),
    execute: async ({ cardCode }: { cardCode?: string }, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: "Consultando pipeline de ventas…" } } as never)
      try {
        const qs = cardCode ? `?cardCode=${cardCode}` : ""
        const data = await client.get<unknown>(`/sales/pipeline${qs}`)
        return { pipeline: data }
      } catch (err) { return classifySapError(err) }
    },
  }),

  analisis_ventas: tool({
    description: "Análisis de ventas: top clientes por revenue, top productos, totales del período.",
    inputSchema: z.object({
      desde: z.string().optional(),
      hasta: z.string().optional(),
      topN: z.number().int().min(1).max(50).default(10),
    }),
    execute: async ({ desde, hasta, topN }: { desde?: string; hasta?: string; topN: number }, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: "Analizando ventas del período…" } } as never)
      try {
        const parts = [`topN=${topN}`]
        if (desde) parts.push(`from=${desde}`)
        if (hasta) parts.push(`to=${hasta}`)
        const data = await client.get<unknown>(`/sales/analysis?${parts.join("&")}`)
        return { analysis: data }
      } catch (err) { return classifySapError(err) }
    },
  }),

  tendencia_ventas: tool({
    description: "Ventas mes a mes últimos 12 meses con variación MoM y YoY.",
    inputSchema: z.object({}),
    execute: async (_args: Record<string, never>, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: "Calculando tendencia de ventas 12 meses…" } } as never)
      try {
        const data = await client.get<unknown>("/sales/trend")
        return { trend: data }
      } catch (err) { return classifySapError(err) }
    },
  }),

  pedidos_retrasados: tool({
    description: "Pedidos de venta con fecha de entrega vencida, ordenados por días de retraso.",
    inputSchema: z.object({ limite: z.number().int().min(1).max(200).default(50) }),
    execute: async ({ limite }: { limite: number }, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: "Consultando pedidos con entrega vencida…" } } as never)
      try {
        const data = await client.get<unknown>(`/sales/delayed?limit=${limite}`)
        return { result: data }
      } catch (err) { return classifySapError(err) }
    },
  }),

  listar_pedidos: tool({
    description: "Lista pedidos de venta con filtros por cliente, estado y fechas.",
    inputSchema: z.object({
      cardCode: z.string().optional(),
      estado: z.enum(["O", "C"]).optional(),
      desde: z.string().optional(),
      hasta: z.string().optional(),
      limite: z.number().int().min(1).max(500).default(50),
    }),
    execute: async ({ cardCode, estado, desde, hasta, limite }: { cardCode?: string; estado?: "O" | "C"; desde?: string; hasta?: string; limite: number }, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: "Consultando pedidos de venta…" } } as never)
      try {
        const parts = [`limit=${limite}`]
        if (cardCode) parts.push(`cardCode=${cardCode}`)
        if (estado) parts.push(`status=${estado}`)
        if (desde) parts.push(`from=${desde}`)
        if (hasta) parts.push(`to=${hasta}`)
        const data = await client.get<unknown>(`/sales/orders?${parts.join("&")}`)
        return { result: data }
      } catch (err) { return classifySapError(err) }
    },
  }),

  detalle_pedido: tool({
    description: "Detalle completo de un pedido de venta por DocEntry: encabezado + líneas.",
    inputSchema: z.object({ docEntry: z.number().int().positive() }),
    execute: async ({ docEntry }: { docEntry: number }, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: `Obteniendo pedido DocEntry ${docEntry}…` } } as never)
      try {
        const data = await client.get<unknown>(`/sales/orders/${docEntry}`)
        return { order: data }
      } catch (err) { return classifySapError(err) }
    },
  }),

  analisis_cotizaciones: tool({
    description: "Pipeline comercial de cotizaciones: tasa de conversión, tiempo promedio de cierre, monto abierto.",
    inputSchema: z.object({ desde: z.string().optional(), hasta: z.string().optional() }),
    execute: async ({ desde, hasta }: { desde?: string; hasta?: string }, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: "Analizando pipeline de cotizaciones…" } } as never)
      try {
        const parts: string[] = []
        if (desde) parts.push(`from=${desde}`)
        if (hasta) parts.push(`to=${hasta}`)
        const data = await client.get<unknown>(`/commercial/quotations${parts.length ? "?" + parts.join("&") : ""}`)
        return { result: data }
      } catch (err) { return classifySapError(err) }
    },
  }),

  clientes_nuevos: tool({
    description: "Clientes con su primera compra en el período indicado.",
    inputSchema: z.object({
      desde: z.string().optional(),
      hasta: z.string().optional(),
      limite: z.number().int().min(1).max(200).default(50),
    }),
    execute: async ({ desde, hasta, limite }: { desde?: string; hasta?: string; limite: number }, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: "Buscando clientes con primera compra…" } } as never)
      try {
        const parts = [`limit=${limite}`]
        if (desde) parts.push(`from=${desde}`)
        if (hasta) parts.push(`to=${hasta}`)
        const data = await client.get<unknown>(`/commercial/new-customers?${parts.join("&")}`)
        return { result: data }
      } catch (err) { return classifySapError(err) }
    },
  }),

  ventas_por_categoria: tool({
    description: "Ventas del período desglosadas por categoría/grupo de producto con % de participación.",
    inputSchema: z.object({ desde: z.string().optional(), hasta: z.string().optional() }),
    execute: async ({ desde, hasta }: { desde?: string; hasta?: string }, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: "Calculando ventas por categoría…" } } as never)
      try {
        const parts: string[] = []
        if (desde) parts.push(`from=${desde}`)
        if (hasta) parts.push(`to=${hasta}`)
        const data = await client.get<unknown>(`/commercial/sales-by-group${parts.length ? "?" + parts.join("&") : ""}`)
        return { result: data }
      } catch (err) { return classifySapError(err) }
    },
  }),
```

- [ ] **Step 2: Type-check y commit**

```bash
npm run type-check
git add app/api/chat/route.ts
git commit -m "feat: tools de ventas y comercial en el chat (9 tools)"
```

---

## Task 10: Chat — tools de inventario y finanzas (7 tools)

**Repo:** `sap-b1-chat`

Insertar después de `ventas_por_categoria`:

- [ ] **Step 1: Añadir 7 tools de inventario y finanzas**

```typescript
  disponibilidad_inventario: tool({
    description: "Stock disponible de un artículo por almacén: existencias, comprometidas y libres para vender.",
    inputSchema: z.object({
      itemCode: z.string(),
      almacen: z.string().optional(),
    }),
    execute: async ({ itemCode, almacen }: { itemCode: string; almacen?: string }, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: `Consultando stock de ${itemCode}…` } } as never)
      try {
        const qs = almacen ? `?almacen=${almacen}` : ""
        const data = await client.get<unknown>(`/inventory/${itemCode}/availability${qs}`)
        return { availability: data }
      } catch (err) { return classifySapError(err) }
    },
  }),

  stock_critico: tool({
    description: "Artículos por debajo del punto de reorden mínimo. Opcionalmente filtrar por almacén.",
    inputSchema: z.object({ almacen: z.string().optional() }),
    execute: async ({ almacen }: { almacen?: string }, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: "Consultando artículos bajo stock mínimo…" } } as never)
      try {
        const qs = almacen ? `?almacen=${almacen}` : ""
        const data = await client.get<{ items?: unknown[]; count?: number }>(`/inventory/low-stock${qs}`)
        return { items: data.items ?? data, count: data.count }
      } catch (err) { return classifySapError(err) }
    },
  }),

  movimientos_inventario: tool({
    description: "Historial de entradas y salidas de un artículo en los últimos N días.",
    inputSchema: z.object({
      itemCode: z.string(),
      dias: z.number().int().min(1).max(365).default(30),
      almacen: z.string().optional(),
    }),
    execute: async ({ itemCode, dias, almacen }: { itemCode: string; dias: number; almacen?: string }, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: `Consultando movimientos de ${itemCode}…` } } as never)
      try {
        const parts = [`days=${dias}`]
        if (almacen) parts.push(`warehouseCode=${almacen}`)
        const data = await client.get<unknown>(`/inventory/${itemCode}/movements?${parts.join("&")}`)
        return { movements: data }
      } catch (err) { return classifySapError(err) }
    },
  }),

  detalle_producto: tool({
    description: "Ficha completa de un producto: descripción, stock por almacén y precios por lista.",
    inputSchema: z.object({ itemCode: z.string() }),
    execute: async ({ itemCode }: { itemCode: string }, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: `Cargando ficha de ${itemCode}…` } } as never)
      try {
        const data = await client.get<unknown>(`/products/${itemCode}`)
        return { product: data }
      } catch (err) { return classifySapError(err) }
    },
  }),

  buscar_productos: tool({
    description: "Busca productos por nombre o código parcial con stock y precio base.",
    inputSchema: z.object({
      texto: z.string(),
      limite: z.number().int().min(1).max(100).default(20),
    }),
    execute: async ({ texto, limite }: { texto: string; limite: number }, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: `Buscando productos '${texto}'…` } } as never)
      try {
        const data = await client.get<unknown>(`/products/search?q=${encodeURIComponent(texto)}&limit=${limite}`)
        return { results: data }
      } catch (err) { return classifySapError(err) }
    },
  }),

  cartera_empresa: tool({
    description: "Análisis de cuentas por cobrar (clientes) o cuentas por pagar (proveedores) con aging en tramos de días.",
    inputSchema: z.object({
      tipo: z.enum(["cuentas_por_cobrar", "cuentas_por_pagar"]),
    }),
    execute: async ({ tipo }: { tipo: "cuentas_por_cobrar" | "cuentas_por_pagar" }, { toolCallId }) => {
      const label = tipo === "cuentas_por_cobrar" ? "cuentas por cobrar" : "cuentas por pagar"
      writer.write({ type: "data-tool-status", data: { toolCallId, text: `Analizando ${label}…` } } as never)
      try {
        const path = tipo === "cuentas_por_cobrar" ? "/finance/receivables" : "/finance/payables"
        const data = await client.get<unknown>(path)
        return { [tipo]: data }
      } catch (err) { return classifySapError(err) }
    },
  }),

  flujo_caja: tool({
    description: "Proyección de flujo de caja a 90 días: cobros esperados vs pagos comprometidos en ventanas de 30 días.",
    inputSchema: z.object({}),
    execute: async (_args: Record<string, never>, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: "Calculando proyección de flujo de caja 90 días…" } } as never)
      try {
        const data = await client.get<unknown>("/finance/cashflow")
        return { cashflow: data }
      } catch (err) { return classifySapError(err) }
    },
  }),
```

- [ ] **Step 2: Type-check y commit**

```bash
npm run type-check
git add app/api/chat/route.ts
git commit -m "feat: tools de inventario y finanzas en el chat (7 tools)"
```

---

## Task 11: Chat — tools de compras y producción lectura (5 tools)

**Repo:** `sap-b1-chat`

Insertar después de `flujo_caja`:

- [ ] **Step 1: Añadir 5 tools de compras y producción**

```typescript
  ordenes_compra: tool({
    description: "Lista órdenes de compra con filtros: por proveedor, estado y fechas.",
    inputSchema: z.object({
      cardCode: z.string().optional(),
      estado: z.enum(["O", "C"]).optional(),
      desde: z.string().optional(),
      hasta: z.string().optional(),
      limite: z.number().int().min(1).max(500).default(50),
    }),
    execute: async ({ cardCode, estado, desde, hasta, limite }: { cardCode?: string; estado?: "O" | "C"; desde?: string; hasta?: string; limite: number }, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: "Consultando órdenes de compra…" } } as never)
      try {
        const parts = [`limit=${limite}`]
        if (cardCode) parts.push(`cardCode=${cardCode}`)
        if (estado) parts.push(`status=${estado}`)
        if (desde) parts.push(`from=${desde}`)
        if (hasta) parts.push(`to=${hasta}`)
        const data = await client.get<unknown>(`/purchasing/orders?${parts.join("&")}`)
        return { result: data }
      } catch (err) { return classifySapError(err) }
    },
  }),

  detalle_orden_compra: tool({
    description: "Detalle completo de una orden de compra: proveedor, artículos pedidos, cantidades recibidas y pendientes.",
    inputSchema: z.object({ docEntry: z.number().int().positive() }),
    execute: async ({ docEntry }: { docEntry: number }, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: `Cargando OC DocEntry ${docEntry}…` } } as never)
      try {
        const data = await client.get<unknown>(`/purchasing/orders/${docEntry}`)
        return { result: data }
      } catch (err) { return classifySapError(err) }
    },
  }),

  ordenes_produccion: tool({
    description: "Órdenes de producción abiertas (Planificadas y Liberadas) con progreso y fecha de vencimiento.",
    inputSchema: z.object({
      itemCode: z.string().optional(),
      limite: z.number().int().min(1).max(500).default(100),
    }),
    execute: async ({ itemCode, limite }: { itemCode?: string; limite: number }, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: "Consultando órdenes de producción abiertas…" } } as never)
      try {
        const parts = [`limit=${limite}`]
        if (itemCode) parts.push(`itemCode=${itemCode}`)
        const data = await client.get<unknown>(`/production/orders?${parts.join("&")}`)
        return { result: data }
      } catch (err) { return classifySapError(err) }
    },
  }),

  detalle_orden_produccion: tool({
    description: "Detalle completo de una orden de producción: artículo terminado, componentes y cantidades.",
    inputSchema: z.object({ docEntry: z.number().int().positive() }),
    execute: async ({ docEntry }: { docEntry: number }, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: `Cargando OP DocEntry ${docEntry}…` } } as never)
      try {
        const data = await client.get<unknown>(`/production/orders/${docEntry}`)
        return { result: data }
      } catch (err) { return classifySapError(err) }
    },
  }),

  faltantes_produccion: tool({
    description: "Componentes con stock insuficiente para completar las órdenes de producción abiertas.",
    inputSchema: z.object({}),
    execute: async (_args: Record<string, never>, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: "Analizando faltantes de materiales…" } } as never)
      try {
        const data = await client.get<unknown>("/production/shortage")
        return { result: data }
      } catch (err) { return classifySapError(err) }
    },
  }),
```

- [ ] **Step 2: Type-check y commit**

```bash
npm run type-check
git add app/api/chat/route.ts
git commit -m "feat: tools de compras y producción en el chat (5 tools)"
```

---

## Task 12: Chat — tools de escritura (13 tools)

**Repo:** `sap-b1-chat`

Los tools de escritura siguen el patrón confirmar: `confirmar=false` devuelve preview (sin llamada al backend), `confirmar=true` llama el backend.

Insertar después de `faltantes_produccion`:

- [ ] **Step 1: Añadir 13 tools de escritura**

```typescript
  validar_y_crear_pedido: tool({
    description:
      "Flujo completo: verifica crédito + stock + crea el pedido. confirmar=false = reporte de validación. confirmar=true = crea si es viable.",
    inputSchema: z.object({
      cardCode: z.string(),
      lines: z.array(z.object({
        itemCode: z.string(),
        quantity: z.number().positive(),
        unitPrice: z.number().nonnegative().optional(),
        warehouseCode: z.string().optional(),
        discount: z.number().min(0).max(100).optional(),
      })).min(1),
      docDate: z.string().optional(),
      dueDate: z.string().optional(),
      comments: z.string().optional(),
      confirmar: z.boolean().default(false),
    }),
    execute: async ({ confirmar, ...header }: { confirmar: boolean; cardCode: string; lines: unknown[]; docDate?: string; dueDate?: string; comments?: string }, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: `Validando pedido para ${header.cardCode}…` } } as never)
      try {
        const data = await client.post<unknown>("/workflows/validate-and-create-order", { ...header, confirmar })
        return { result: data }
      } catch (err) { return classifySapError(err) }
    },
  }),

  reponer_faltantes: tool({
    description: "Detecta faltantes en producción y genera OCs por proveedor. confirmar=false = plan de compras. confirmar=true = crea las OCs.",
    inputSchema: z.object({
      defaultSupplier: z.string(),
      supplierByWarehouse: z.string().optional(),
      confirmar: z.boolean().default(false),
    }),
    execute: async ({ defaultSupplier, supplierByWarehouse, confirmar }: { defaultSupplier: string; supplierByWarehouse?: string; confirmar: boolean }, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: "Analizando faltantes y generando plan…" } } as never)
      try {
        const data = await client.post<unknown>("/workflows/replenish-shortages", { defaultSupplier, supplierByWarehouse, confirmar })
        return { result: data }
      } catch (err) { return classifySapError(err) }
    },
  }),

  facturar_pedido: tool({
    description: "Convierte un pedido de venta en factura. confirmar=false = preview. confirmar=true = crea en SAP.",
    inputSchema: z.object({
      docEntry: z.number().int().positive(),
      confirmar: z.boolean().default(false),
    }),
    execute: async ({ docEntry, confirmar }: { docEntry: number; confirmar: boolean }, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: confirmar ? `Creando factura del pedido ${docEntry}…` : `Preparando factura del pedido ${docEntry}…` } } as never)
      try {
        const data = await client.post<unknown>("/workflows/order-to-invoice", { docEntry, confirmar })
        return { result: data }
      } catch (err) { return classifySapError(err) }
    },
  }),

  crear_pedido: tool({
    description: "Crea un pedido de venta. REGLA: llamar primero con confirmar=false para preview. Solo confirmar=true si el usuario aprobó.",
    inputSchema: z.object({
      cardCode: z.string(),
      lines: z.array(z.object({ itemCode: z.string(), quantity: z.number().positive(), unitPrice: z.number().nonnegative().optional(), warehouseCode: z.string().optional(), discount: z.number().min(0).max(100).optional() })).min(1),
      docDate: z.string().optional(),
      dueDate: z.string().optional(),
      comments: z.string().optional(),
      reference: z.string().optional(),
      confirmar: z.boolean().default(false),
    }),
    execute: async ({ confirmar, ...header }: { confirmar: boolean; cardCode: string; lines: unknown[]; docDate?: string; dueDate?: string; comments?: string; reference?: string }, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: confirmar ? `Creando pedido para ${header.cardCode}…` : `Preparando pedido para ${header.cardCode}…` } } as never)
      if (!confirmar) return { preview: header, mensaje: "Vista previa. Confirma para crear en SAP." }
      try {
        const data = await client.post<unknown>("/ventas/pedidos", header)
        return { result: data }
      } catch (err) { return classifySapError(err) }
    },
  }),

  cancelar_pedido: tool({
    description: "Cancela un pedido de venta abierto. Irreversible. REGLA: confirmar=false primero para advertencia.",
    inputSchema: z.object({
      docEntry: z.number().int().positive(),
      confirmar: z.boolean().default(false),
    }),
    execute: async ({ docEntry, confirmar }: { docEntry: number; confirmar: boolean }, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: confirmar ? `Cancelando pedido ${docEntry}…` : `Preparando cancelación de pedido ${docEntry}…` } } as never)
      if (!confirmar) return { advertencia: `Se cancelará el pedido DocEntry ${docEntry}. Esta acción es irreversible. ¿Confirmas?` }
      try {
        const data = await client.post<unknown>(`/sales/orders/${docEntry}/cancel`, {})
        return { result: data }
      } catch (err) { return classifySapError(err) }
    },
  }),

  crear_cotizacion: tool({
    description: "Crea una cotización de venta. REGLA: confirmar=false primero.",
    inputSchema: z.object({
      cardCode: z.string(),
      lines: z.array(z.object({ itemCode: z.string(), quantity: z.number().positive(), unitPrice: z.number().nonnegative().optional(), warehouseCode: z.string().optional(), discount: z.number().min(0).max(100).optional() })).min(1),
      docDate: z.string().optional(),
      dueDate: z.string().optional(),
      comments: z.string().optional(),
      confirmar: z.boolean().default(false),
    }),
    execute: async ({ confirmar, ...header }: { confirmar: boolean; cardCode: string; lines: unknown[]; docDate?: string; dueDate?: string; comments?: string }, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: confirmar ? `Creando cotización para ${header.cardCode}…` : `Preparando cotización para ${header.cardCode}…` } } as never)
      if (!confirmar) return { preview: header, mensaje: "Vista previa. Confirma para crear en SAP." }
      try {
        const data = await client.post<unknown>("/ventas/cotizaciones", header)
        return { result: data }
      } catch (err) { return classifySapError(err) }
    },
  }),

  convertir_cotizacion: tool({
    description: "Convierte una cotización en pedido de venta. REGLA: confirmar=false primero.",
    inputSchema: z.object({
      docEntry: z.number().int().positive(),
      confirmar: z.boolean().default(false),
    }),
    execute: async ({ docEntry, confirmar }: { docEntry: number; confirmar: boolean }, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: confirmar ? `Convirtiendo cotización ${docEntry}…` : `Preparando conversión de cotización ${docEntry}…` } } as never)
      if (!confirmar) return { advertencia: `Se convertirá la cotización DocEntry ${docEntry} en pedido. ¿Confirmas?` }
      try {
        const data = await client.post<unknown>(`/quotations/${docEntry}/convert`, {})
        return { result: data }
      } catch (err) { return classifySapError(err) }
    },
  }),

  crear_orden_compra: tool({
    description: "Crea una orden de compra a un proveedor. REGLA: confirmar=false primero.",
    inputSchema: z.object({
      cardCode: z.string(),
      lines: z.array(z.object({ itemCode: z.string(), quantity: z.number().positive(), unitPrice: z.number().nonnegative().optional(), warehouseCode: z.string().optional() })).min(1),
      docDate: z.string().optional(),
      dueDate: z.string().optional(),
      comments: z.string().optional(),
      reference: z.string().optional(),
      confirmar: z.boolean().default(false),
    }),
    execute: async ({ confirmar, ...header }: { confirmar: boolean; cardCode: string; lines: unknown[]; docDate?: string; dueDate?: string; comments?: string; reference?: string }, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: confirmar ? `Creando OC para ${header.cardCode}…` : `Preparando OC para ${header.cardCode}…` } } as never)
      if (!confirmar) return { preview: header, mensaje: "Vista previa. Confirma para crear en SAP." }
      try {
        const data = await client.post<unknown>("/compras/ordenes", header)
        return { result: data }
      } catch (err) { return classifySapError(err) }
    },
  }),

  cancelar_orden_compra: tool({
    description: "Cancela una orden de compra abierta. Irreversible. REGLA: confirmar=false primero.",
    inputSchema: z.object({
      docEntry: z.number().int().positive(),
      confirmar: z.boolean().default(false),
    }),
    execute: async ({ docEntry, confirmar }: { docEntry: number; confirmar: boolean }, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: confirmar ? `Cancelando OC ${docEntry}…` : `Preparando cancelación de OC ${docEntry}…` } } as never)
      if (!confirmar) return { advertencia: `Se cancelará la OC DocEntry ${docEntry}. Esta acción es irreversible. ¿Confirmas?` }
      try {
        const data = await client.post<unknown>(`/purchasing/orders/${docEntry}/cancel`, {})
        return { result: data }
      } catch (err) { return classifySapError(err) }
    },
  }),

  crear_orden_produccion: tool({
    description: "Crea una orden de producción. REGLA: confirmar=false primero.",
    inputSchema: z.object({
      itemCode: z.string(),
      plannedQty: z.number().positive(),
      dueDate: z.string().optional(),
      startDate: z.string().optional(),
      warehouseCode: z.string().optional(),
      comments: z.string().optional(),
      confirmar: z.boolean().default(false),
    }),
    execute: async ({ confirmar, ...payload }: { confirmar: boolean; itemCode: string; plannedQty: number; dueDate?: string; startDate?: string; warehouseCode?: string; comments?: string }, { toolCallId }) => {
      writer.write({ type: "data-tool-status", data: { toolCallId, text: confirmar ? `Creando OP para ${payload.itemCode}…` : `Preparando OP para ${payload.itemCode}…` } } as never)
      if (!confirmar) return { preview: payload, mensaje: "Vista previa. Confirma para crear en SAP." }
      try {
        const data = await client.post<unknown>("/produccion/ordenes", payload)
        return { result: data }
      } catch (err) { return classifySapError(err) }
    },
  }),

  crear_documento: tool({
    description: "Crea un documento de negocio genérico. REGLA: confirmar=false primero. Dominios: ventas/pedidos, ventas/cotizaciones, ventas/facturas, compras/ordenes.",
    inputSchema: z.object({
      endpoint: z.string().describe("Ej: 'compras/ordenes', 'ventas/cotizaciones'"),
      payload: z.string().describe("JSON del documento como string"),
      confirmar: z.boolean(),
    }),
    execute: async ({ endpoint, payload, confirmar }: { endpoint: string; payload: string; confirmar: boolean }, { toolCallId }) => {
      const entityKey = endpoint.replace(/^\//, "")
      const cfg = ENTITY_MAP[entityKey]
      if (!cfg) return { error: { code: "INVALID_ENDPOINT", message: `Endpoint '${endpoint}' no reconocido. Válidos: ${Object.keys(ENTITY_MAP).join(", ")}`, retryable: false } }
      let parsed: unknown
      try { parsed = JSON.parse(payload) } catch { return { error: { code: "INVALID_JSON", message: "El payload no es JSON válido.", retryable: false } } }
      if (!confirmar) return { preview: parsed, entidad_sap: cfg.sapEntity, mensaje: "Vista previa. Muestra al usuario y pide confirmación." }
      writer.write({ type: "data-tool-status", data: { toolCallId, text: `Creando documento en ${cfg.sapEntity}…` } } as never)
      try {
        const result = await client.sapWrite("POST", `/${cfg.sapEntity}`, parsed)
        return { creado: result.result, mensaje: "Documento creado exitosamente en SAP." }
      } catch (err) { return classifySapError(err) }
    },
  }),

  actualizar_documento: tool({
    description: "Modifica campos de un documento existente. REGLA: confirmar=false primero.",
    inputSchema: z.object({
      endpoint: z.string(),
      id: z.string(),
      cambios: z.string().describe("JSON con solo los campos a modificar"),
      confirmar: z.boolean(),
    }),
    execute: async ({ endpoint, id, cambios, confirmar }: { endpoint: string; id: string; cambios: string; confirmar: boolean }, { toolCallId }) => {
      const entityKey = endpoint.replace(/^\//, "")
      const cfg = ENTITY_MAP[entityKey]
      if (!cfg) return { error: { code: "INVALID_ENDPOINT", message: `Endpoint '${endpoint}' no reconocido.`, retryable: false } }
      let parsed: unknown
      try { parsed = JSON.parse(cambios) } catch { return { error: { code: "INVALID_JSON", message: "Los cambios no son JSON válido.", retryable: false } } }
      const key = cfg.keyType === "string" ? `('${encodeURIComponent(id)}')` : `(${id})`
      if (!confirmar) return { documento: `${cfg.sapEntity}${key}`, cambios: parsed, mensaje: "Vista previa. Muestra los campos a modificar y pide confirmación." }
      writer.write({ type: "data-tool-status", data: { toolCallId, text: `Actualizando ${cfg.sapEntity}${key}…` } } as never)
      try {
        await client.sapWrite("PATCH", `/${cfg.sapEntity}${key}`, parsed)
        return { actualizado: true, documento: `${cfg.sapEntity}${key}`, mensaje: "Documento actualizado exitosamente." }
      } catch (err) { return classifySapError(err) }
    },
  }),

  ejecutar_accion: tool({
    description: "Ejecuta una acción en un documento: Cancel, Close, Reopen. REGLA: confirmar=false primero — puede ser irreversible.",
    inputSchema: z.object({
      endpoint: z.string(),
      docEntry: z.string(),
      accion: z.string().describe("Cancel, Close o Reopen"),
      confirmar: z.boolean(),
    }),
    execute: async ({ endpoint, docEntry, accion, confirmar }: { endpoint: string; docEntry: string; accion: string; confirmar: boolean }, { toolCallId }) => {
      const entityKey = endpoint.replace(/^\//, "")
      const cfg = ENTITY_MAP[entityKey]
      if (!cfg) return { error: { code: "INVALID_ENDPOINT", message: `Endpoint '${endpoint}' no reconocido.`, retryable: false } }
      if (!cfg.allowedActions?.includes(accion)) {
        return { error: { code: "INVALID_ACTION", message: `Acción '${accion}' no permitida en '${endpoint}'. Válidas: ${cfg.allowedActions?.join(", ") ?? "ninguna"}`, retryable: false } }
      }
      if (!confirmar) return { accion, documento: `${cfg.sapEntity}(${docEntry})`, advertencia: `Esta acción ejecutará '${accion}' en el documento ${docEntry}. Puede ser irreversible. ¿Confirmas?` }
      writer.write({ type: "data-tool-status", data: { toolCallId, text: `Ejecutando ${accion} en ${cfg.sapEntity}(${docEntry})…` } } as never)
      try {
        const result = await client.sapWrite("ACTION", `/${cfg.sapEntity}(${docEntry})/${accion}`)
        return { ejecutado: true, accion, docEntry, mensaje: `Acción '${accion}' ejecutada exitosamente.`, detalles: result.result }
      } catch (err) { return classifySapError(err) }
    },
  }),

  // Fin de todos los tools
}, // cierre de tools:
```

- [ ] **Step 2: Type-check final**

```bash
npm run type-check
```
Esperado: sin errores.

- [ ] **Step 3: Commit**

```bash
git add app/api/chat/route.ts
git commit -m "feat: tools de escritura en el chat — migración LLM completa (47 tools)"
```

---

## Task 13: Test end-to-end + push final

**Repos:** ambos

- [ ] **Step 1: Arrancar backend en modo dev**

```bash
cd /home/ai_tamaprint/Software/clients/AI4U/experiments/superAI/sap-b1-backend
npm run dev &
sleep 4
```

- [ ] **Step 2: Arrancar chat en modo dev**

```bash
cd /home/ai_tamaprint/Software/clients/AI4U/experiments/superAI/sap-b1-chat
npm run dev &
sleep 4
```

- [ ] **Step 3: Verificar los 3 endpoints nuevos del backend**

```bash
BACKEND=http://localhost:4100
KEY=$(grep "^TAMAPRINT_API_KEY=" /home/ai_tamaprint/Software/clients/AI4U/experiments/superAI/sap-b1-backend/.env.local | cut -d= -f2)

# Schema endpoint
curl -s "$BACKEND/api/v1/tamaprint/schema?q=OINV" -H "X-API-Key: $KEY" | python3 -m json.tool | head -20

# OData proxy
curl -s "$BACKEND/api/v1/tamaprint/odata?path=$(python3 -c "import urllib.parse; print(urllib.parse.quote('/Warehouses?\$top=2'))")" -H "X-API-Key: $KEY" | python3 -m json.tool | head -10
```
Esperado: JSON con resultados válidos de SAP.

- [ ] **Step 4: Test de chat directo**

```bash
# Obtener cookie de sesión válida del chat (requiere haber accedido via browser primero)
# Alternativa: test directo al chat route con curl simulando cookie
CHAT=http://localhost:4101
curl -s -X POST "$CHAT/api/chat" \
  -H "Content-Type: application/json" \
  -H "Cookie: sap_chat_session=TOKEN_VALIDO" \
  -d '{"messages":[{"role":"user","content":"¿Cuántos almacenes hay?"}]}' \
  --max-time 30 | head -c 500
```
Esperado: stream SSE con respuesta del LLM sobre los almacenes de SAP.

- [ ] **Step 5: Push ambos repos**

```bash
cd /home/ai_tamaprint/Software/clients/AI4U/experiments/superAI/sap-b1-backend
git push

cd /home/ai_tamaprint/Software/clients/AI4U/experiments/superAI/sap-b1-chat
git push
```

- [ ] **Step 6: Matar los servidores dev**

```bash
kill $(lsof -t -i:4100) $(lsof -t -i:4101) 2>/dev/null || true
```

---

## Self-Review

**Spec coverage:**
- ✅ 3 endpoints nuevos en backend (Tasks 1-2)
- ✅ BackendClient (Task 3)
- ✅ EntityMap copiado (Task 3)
- ✅ lib/chat files (Task 4)
- ✅ Route scaffold con auth, model selection, pruning, discoveredTables (Task 5)
- ✅ 5 tools schema/SQL/catálogo (Task 6)
- ✅ 3 tools OData (Task 7)
- ✅ 6 tools clientes (Task 8)
- ✅ 9 tools ventas+comercial (Task 9)
- ✅ 7 tools inventario+finanzas (Task 10)
- ✅ 5 tools compras+producción (Task 11)
- ✅ 13 tools escritura (Task 12)
- ✅ Sessions eliminadas — historial en cliente (Task 5)
- ✅ e2e test (Task 13)
- ✅ Push ambos repos (Task 13)

**Total tools:** 5+3+6+9+7+5+13 = **48 tools** (47 del backend original + listar_queries_catalogo que se mantuvo)

**Placeholder scan:** Ninguno encontrado.

**Type consistency:** `BackendClient` definido en Task 3, usado en Tasks 4-12. `ENTITY_MAP` definido en Task 3, usado en Tasks 7 y 12. `classifySapError`, `writer`, `client`, `discoveredTables` definidos en Task 5, usados en Tasks 6-12.
