"use client"

import { useCallback, useEffect, useState } from "react"

// ─── Cache por día ────────────────────────────────────────────────────────────
// La clave incluye la fecha local → expira automáticamente al día siguiente.
// Claves viejas se limpian al montar para no acumular localStorage.

function todayKey() {
  return `sap-b1-suggestions-${new Date().toISOString().slice(0, 10)}`
}

function loadCache(): string[] | null {
  try {
    const raw = localStorage.getItem(todayKey())
    if (!raw) return null
    const { questions } = JSON.parse(raw) as { questions: string[] }
    return Array.isArray(questions) ? questions : null
  } catch {
    return null
  }
}

function saveCache(questions: string[]) {
  localStorage.setItem(todayKey(), JSON.stringify({ questions }))
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

  const fetch_ = useCallback(
    async (force = false) => {
      // Serve from cache unless forced refresh
      if (!force) {
        const cached = loadCache()
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

        if (questions.length > 0) saveCache(questions)
      } catch {
        const stale = loadCache()
        if (stale) {
          setSuggestions(stale)
          setStatus("ready")
        } else {
          setStatus("error")
        }
      }
    },
    [tenantName],
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
