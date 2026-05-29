"use client"

import { useCallback, useEffect, useState } from "react"

// ─── Cache por día ────────────────────────────────────────────────────────────
// La clave incluye la fecha local → expira automáticamente al día siguiente.
// Claves viejas se limpian al montar para no acumular localStorage.

function todayKey() {
  return `sap-b1-suggestions-${new Date().toISOString().slice(0, 10)}`
}

function loadCache(tenant: string): string[] | null {
  try {
    const raw = localStorage.getItem(todayKey())
    if (!raw) return null
    const { questions, tenant: cachedTenant } = JSON.parse(raw) as {
      questions: string[]
      tenant?: string
    }
    // Invalidate if cached for a different tenant (prevents cross-tenant leak)
    if (cachedTenant !== tenant) return null
    return Array.isArray(questions) ? questions : null
  } catch {
    return null
  }
}

function saveCache(questions: string[], tenant: string) {
  localStorage.setItem(todayKey(), JSON.stringify({ questions, tenant }))
}

function pruneOldCacheKeys() {
  const current = todayKey()
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith("sap-b1-suggestions-") && k !== current) {
      localStorage.removeItem(k)
    }
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export type SuggestionsStatus = "idle" | "loading" | "ready" | "error"

export function useSuggestions(tenantName?: string) {
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [status, setStatus] = useState<SuggestionsStatus>("idle")

  // Cache is keyed by tenant to prevent serving one tenant's questions to another
  const tenantKey = tenantName?.trim() || "_"

  const fetch_ = useCallback(
    async (force = false) => {
      // Serve from cache unless forced refresh
      if (!force) {
        const cached = loadCache(tenantKey)
        if (cached) {
          setSuggestions(cached)
          setStatus("ready")
          return
        }
      }

      setStatus("loading")
      try {
        const res = await fetch("/api/suggestions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tenantName }),
          signal: AbortSignal.timeout(30_000),
        })

        if (!res.ok) throw new Error(`HTTP ${res.status}`)

        const data = (await res.json()) as { questions: string[] }
        const questions = data.questions ?? []

        setSuggestions(questions)
        setStatus("ready")

        if (questions.length > 0) saveCache(questions, tenantKey)
      } catch {
        const stale = loadCache(tenantKey)
        if (stale) {
          setSuggestions(stale)
          setStatus("ready")
        } else {
          setStatus("error")
        }
      }
    },
    [tenantName, tenantKey],
  )

  useEffect(() => {
    pruneOldCacheKeys()
    fetch_()
  }, [fetch_])

  return {
    suggestions,
    status,
    /** Regenerar preguntas ignorando caché (llama al LLM de nuevo) */
    refresh: () => fetch_(true),
  }
}
