export type TenantId = string

export interface TenantProfile {
  nombre: string
  industria: string
  pais: string
  moneda: string
  periodoFiscal: string
  lineasNegocio: string[]
  glosario: Record<string, string>
  modulosActivos: string[]
}

export const TENANT_PROFILES: Record<TenantId, TenantProfile> = {
  tamaprint: {
    nombre: "Tamaprint S.A.S.",
    industria: "Impresión comercial y producción gráfica",
    pais: "Colombia",
    moneda: "COP",
    periodoFiscal: "Enero – Diciembre",
    lineasNegocio: ["Offset", "Digital", "Gran formato", "Acabados"],
    glosario: {
      tecnología: "familia de artículos / grupo de ítem (OITB.ItmsGrpNam)",
      tiraje: "cantidad de impresiones por trabajo",
    },
    modulosActivos: [
      "compras",
      "ventas",
      "inventario",
      "socios",
      "pagos",
      "contabilidad",
      "produccion",
      "sistema",
      "rrhh",
    ],
  },
  flexoimpresos: {
    nombre: "FlexoImpresos S.A.S.",
    industria: "Impresión flexográfica y empaques flexibles",
    pais: "Colombia",
    moneda: "COP",
    periodoFiscal: "Enero – Diciembre",
    lineasNegocio: ["Flexografía", "Etiquetas", "Empaques flexibles"],
    glosario: {
      sustrato: "familia de material / grupo de ítem (tipo de lámina o papel)",
      "ancho de bobina": "campo de medida en la descripción del ítem",
    },
    modulosActivos: [
      "compras",
      "ventas",
      "inventario",
      "socios",
      "pagos",
      "contabilidad",
      "sistema",
    ],
  },
}

export function getTenantProfile(tenant: TenantId): TenantProfile {
  const profile = TENANT_PROFILES[tenant]
  if (!profile) throw new Error(`Tenant desconocido: "${tenant}"`)
  return profile
}
