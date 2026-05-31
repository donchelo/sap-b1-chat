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

  schema(q: string) {
    return this.get<{ resultados: unknown[]; count: number }>(
      `/schema?q=${encodeURIComponent(q)}`
    )
  }

  odata<T>(odataPath: string) {
    return this.get<T>(`/odata?path=${encodeURIComponent(odataPath)}`)
  }

  sapQuery(sql: string, limit = 500) {
    return this.post<{ rows: unknown[]; count: number }>("/query", { sql, limit })
  }

  catalogList() {
    return this.get<{ queries: Array<{ name: string; description: string; params: string[] }> }>(
      "/query/catalog"
    )
  }

  catalogQuery(name: string, params?: unknown, limit?: number) {
    return this.post<{ rows: unknown[]; count: number; query: string }>("/query/catalog", {
      query: name,
      params,
      limit,
    })
  }

  sapWrite<T = unknown>(method: "POST" | "PATCH" | "ACTION", path: string, body?: unknown) {
    return this.post<{ result?: T; ok?: boolean }>("/sap-write", { method, path, body })
  }
}
