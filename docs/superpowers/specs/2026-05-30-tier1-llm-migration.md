# Tier 1: Migración LLM — Backend → sap-b1-chat

**Fecha:** 2026-05-30  
**Estado:** Aprobado

## Problema

El LLM (Anthropic), los 47 tools, el system prompt y la gestión de sesiones viven actualmente en `sap-b1-backend`. Esto acopla la inteligencia del chat con la API de datos SAP, impide que el backend sea un servicio de datos reutilizable puro, y hace que el `sap-b1-chat` sea un proxy vacío sin lógica propia.

Ambos servicios corren en Vercel (serverless). Las sessions in-memory del backend ya estaban rotas en producción (multi-instancia). Se eliminan sin riesgo.

---

## Arquitectura objetivo

```
Browser
  └── useChat (historial de mensajes en cliente, AI SDK)
        ↓ POST /api/chat  (historial completo en cada request)
sap-b1-chat (Vercel)
  └── app/api/chat/route.ts   ← LLM + 47 tools aquí
        ↓ HTTP + X-API-Key
sap-b1-backend (Vercel)
  └── REST endpoints puros (datos SAP, sin Anthropic, sin tools)
```

---

## Cambios en sap-b1-backend (2 endpoints nuevos)

### 1. `GET /api/v1/[tenant]/schema`

Parámetro: `?q=TERM` (nombre de tabla o concepto)  
Wrappea `buscarMetadatoTabla(term)` de `lib/sap/metadata.ts`.  
Respuesta: `{ resultados: MetadatoTabla[], count: number }`

Necesario para el tool `descubrir_esquema`, que actualmente llama la función directamente.

### 2. `GET /api/v1/[tenant]/odata`

Parámetro: `?path=` (URL OData relativa, ej: `/BusinessPartners?$top=10&$filter=...`)  
Llama `sapGet(cfg, path)` y devuelve el resultado como JSON.  
Necesario para los tools `listar_registros` y `obtener_documento`, que construyen URLs OData dinámicas.

Autenticación: igual que el resto de endpoints (header `X-API-Key`).

---

## Cambios en sap-b1-chat

### Nuevas dependencias

```json
"@ai-sdk/anthropic": "latest",
"zod": "latest"
```

### Archivos nuevos / modificados

| Archivo | Acción | Descripción |
|---------|--------|-------------|
| `lib/backend-client.ts` | Crear | Cliente HTTP tipado para el backend |
| `lib/chat/system-prompt.ts` | Copiar desde backend | Sin cambios de contenido |
| `lib/chat/tenant-profiles.ts` | Copiar desde backend | Sin cambios de contenido |
| `lib/chat/sap-context.ts` | Crear (reescrito) | Llama `/sistema/almacenes`, `/sistema/vendedores`, etc. vía BackendClient |
| `app/api/chat/route.ts` | Reemplazar | De proxy thin → LLM completo con 47 tools |

### BackendClient

Cliente con métodos tipados que encapsulan `fetch` + `X-API-Key` + `BACKEND_URL`:

```typescript
class BackendClient {
  get<T>(path: string): Promise<T>
  post<T>(path: string, body: unknown): Promise<T>
  patch(path: string, body: unknown): Promise<void>
  
  // Atajos para los tools más usados
  schema(q: string): Promise<{ resultados: unknown[]; count: number }>
  odata<T>(odataPath: string): Promise<T>
  sapQuery(sql: string, limit?: number): Promise<{ rows: unknown[]; count: number }>
  catalogQuery(name: string, params?: unknown, limit?: number): Promise<{ rows: unknown[]; count: number; query: string }>
}
```

Se instancia una vez por request con `tenantId` + `apiKey` de la sesión `@ai4u/mc-sso`.

### app/api/chat/route.ts (nuevo)

Reemplaza el proxy actual. Responsabilidades:

1. **Auth**: leer `tenantId` + `apiKey` de la cookie de sesión via `@ai4u/mc-sso`
2. **Modelo**: selección de modelo (haiku/sonnet/opus) igual que backend actual
3. **Context**: llamar `buildStaticSystemPrompt` + `buildDynamicSystemContext` + `fetchSapContext`
4. **Pruning**: aplicar `pruneMessages` al historial entrante (elimina sessions externas)
5. **discoveredTables**: `Set<string>` por request para validar SQL antes de ejecutar
6. **47 tools**: reimplementados como llamadas HTTP al BackendClient
7. **Stream**: devolver `createUIMessageStreamResponse` (mismo protocolo que antes)

### Sessions: eliminadas

El historial vive en el cliente (hook `useChat`). Cada request envía el historial completo. El route aplica `pruneMessages` + cap de 60 mensajes antes de llamar al LLM. Sin `Map` en memoria, sin `sessionId`, sin `saveSession`/`loadSession`.

El endpoint `app/api/v1/chat/sessions/[sessionId]/route.ts` del backend se depreca.

---

## Mapeo: tool → endpoint backend

### Tools de lectura (GET)

| Tool | Endpoint backend |
|------|-----------------|
| `descubrir_esquema` | `GET /schema?q=` |
| `consultar_sql` | `POST /query` |
| `ejecutar_query_catalogo` | `POST /query/catalog` |
| `listar_queries_catalogo` | `GET /query/catalog` |
| `listar_registros` | `GET /odata?path=` |
| `obtener_documento` | `GET /odata?path=` |
| `buscar_socio_o_item` | `GET /odata?path=` |
| `perfil_cliente` | `GET /customers/{cardCode}/summary` o `balance` |
| `historial_cliente` | `GET /customers/{cardCode}/history?months=&topN=` |
| `aging_cliente` | `GET /customers/{cardCode}/aging` |
| `verificar_credito` | `GET /customers/{cardCode}/credit-check` |
| `pagos_cliente` | `GET /customers/{cardCode}/payments?limit=` |
| `clientes_inactivos` | `GET /customers/churn?months=&limit=` |
| `pipeline_ventas` | `GET /sales/pipeline?cardCode=` |
| `analisis_ventas` | `GET /sales/analysis?from=&to=&topN=` |
| `tendencia_ventas` | `GET /sales/trend` |
| `pedidos_retrasados` | `GET /sales/delayed?limit=` |
| `listar_pedidos` | `GET /sales/orders?cardCode=&status=&from=&to=&limit=` |
| `detalle_pedido` | `GET /sales/orders/{docEntry}` |
| `analisis_cotizaciones` | `GET /commercial/quotations?from=&to=` |
| `clientes_nuevos` | `GET /commercial/new-customers?from=&to=&limit=` |
| `ventas_por_categoria` | `GET /commercial/sales-by-group?from=&to=` |
| `disponibilidad_inventario` | `GET /inventory/{itemCode}/availability?almacen=` |
| `stock_critico` | `GET /inventory/low-stock?almacen=` |
| `movimientos_inventario` | `GET /inventory/{itemCode}/movements?dias=&almacen=` |
| `detalle_producto` | `GET /products/{itemCode}` |
| `buscar_productos` | `GET /products/search?q=&limit=` |
| `cartera_empresa` | `GET /finance/receivables` o `/finance/payables` |
| `flujo_caja` | `GET /finance/cashflow` |
| `ordenes_compra` | `GET /purchasing/orders?cardCode=&status=&from=&to=&limit=` |
| `detalle_orden_compra` | `GET /purchasing/orders/{docEntry}` |
| `ordenes_produccion` | `GET /production/orders?itemCode=&limit=` |
| `detalle_orden_produccion` | `GET /production/orders/{docEntry}` |
| `faltantes_produccion` | `GET /production/shortage` |

### Tools de escritura (POST/PATCH)

| Tool | Endpoint backend |
|------|-----------------|
| `crear_pedido` | `POST /ventas/pedidos` |
| `cancelar_pedido` | `POST /sales/orders/{docEntry}/cancel` |
| `crear_cotizacion` | `POST /ventas/cotizaciones` |
| `convertir_cotizacion` | `POST /quotations/{docEntry}/convert` |
| `crear_orden_compra` | `POST /compras/ordenes` |
| `cancelar_orden_compra` | `POST /purchasing/orders/{docEntry}/cancel` |
| `crear_orden_produccion` | `POST /produccion/ordenes` |
| `validar_y_crear_pedido` | `POST /workflows/validate-and-create-order` |
| `reponer_faltantes` | `POST /workflows/replenish-shortages` |
| `facturar_pedido` | `POST /workflows/order-to-invoice` |
| `crear_documento` | `POST /{entity}` vía OData proxy o endpoint específico |
| `actualizar_documento` | `PATCH /{entity}({id})` vía OData proxy |
| `ejecutar_accion` | `POST /{entity}({id})/{action}` vía OData proxy |

---

## Variables de entorno en Vercel (sap-b1-chat)

```
# Backend
BACKEND_URL=https://sap-backend.vercel.app

# API keys por tenant (las lee getApiKey() de @ai4u/mc-sso)
TAMAPRINT_SAP_API_KEY=...
FLEXOIMPRESOS_SAP_API_KEY=...

# Anthropic por tenant
TAMAPRINT_ANTHROPIC_API_KEY=...
FLEXOIMPRESOS_ANTHROPIC_API_KEY=...

# SSO (ya existe)
MISSION_CONTROL_SECRET=...
```

---

## Qué NO cambia

- UI del chat (components, hooks, `page.tsx`) — sin tocar
- Todos los REST endpoints del backend — sin tocar  
- MCP server del backend — sin tocar
- Query catalog del backend — sin tocar
- `/api/v1/chat` del backend — queda deprecated, se elimina en Tier 2
- Auth flow via `@ai4u/mc-sso` — sin tocar

---

## Criterios de éxito

1. `npm run type-check` pasa en ambos repos
2. `GET http://localhost:4101/api/chat` con pregunta de ventas devuelve respuesta LLM correcta
3. Los 47 tools responden igual que antes (misma data, mismos campos)
4. El backend no tiene referencia a Anthropic ni a tools LLM
5. La UI del chat no requiere ningún cambio
