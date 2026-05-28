"use client"

import { useEffect, useRef, useState } from "react"

interface ChangelogEntry {
  version: string
  date: string
  changes: string[]
}

interface ChangelogData {
  currentVersion: string
  entries: ChangelogEntry[]
}

const TYPE_COLORS: Record<string, string> = {
  feat:     "var(--ai4u-black)",
  fix:      "var(--ai4u-orange)",
  refactor: "var(--ai4u-cadet-gray)",
  chore:    "var(--ai4u-cadet-gray)",
}

const TYPE_LABELS: Record<string, string> = {
  feat:     "feat",
  fix:      "fix",
  refactor: "refactor",
  chore:    "chore",
}

function parseChange(change: string): { type: string; text: string } {
  const match = change.match(/^(feat|fix|refactor|chore):\s*(.+)/)
  if (match) return { type: match[1], text: match[2] }
  return { type: "chore", text: change }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es", { year: "numeric", month: "short", day: "numeric" })
}

export function ChangelogModal({
  version,
  onClose,
}: {
  version: string
  onClose: () => void
}) {
  const [data, setData] = useState<ChangelogData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch("/api/changelog")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setData(d))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div
      ref={overlayRef}
      style={s.overlay}
      onClick={(e) => { if (e.target === overlayRef.current) onClose() }}
    >
      <div style={s.modal} role="dialog" aria-modal="true" aria-label="Historial de cambios">
        <div style={s.header}>
          <div>
            <div style={s.title}>Historial de cambios</div>
            <div style={s.subtitle}>SAP B1 Chat · v{version}</div>
          </div>
          <button onClick={onClose} style={s.closeBtn} aria-label="Cerrar">✕</button>
        </div>

        <div style={s.body}>
          {loading && (
            <div style={s.center}>
              <span style={{ color: "var(--ai4u-cadet-gray)", fontSize: 13 }}>Cargando…</span>
            </div>
          )}

          {error && (
            <div style={s.center}>
              <span style={{ color: "var(--ai4u-orange)", fontSize: 13 }}>
                No se pudo cargar el historial.
              </span>
            </div>
          )}

          {!loading && !error && data && data.entries.map((entry) => (
            <div key={entry.version} style={s.entry}>
              <div style={s.entryHeader}>
                <span style={s.entryVersion}>v{entry.version}</span>
                <span style={s.entryDate}>{formatDate(entry.date)}</span>
              </div>
              <ul style={s.changeList}>
                {entry.changes.map((change, i) => {
                  const { type, text } = parseChange(change)
                  return (
                    <li key={i} style={s.changeItem}>
                      <span style={{ ...s.typeBadge, color: TYPE_COLORS[type] ?? "var(--ai4u-cadet-gray)" }}>
                        {TYPE_LABELS[type] ?? type}
                      </span>
                      <span style={s.changeText}>{text}</span>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed", inset: 0, zIndex: 1000,
    background: "rgba(0,0,0,0.45)",
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: 16,
  },
  modal: {
    background: "var(--ai4u-bg-default)",
    border: "1px solid var(--ai4u-border-color)",
    borderRadius: 12,
    width: "100%", maxWidth: 480,
    maxHeight: "80dvh",
    display: "flex", flexDirection: "column",
    overflow: "hidden",
    boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
  },
  header: {
    display: "flex", justifyContent: "space-between", alignItems: "flex-start",
    padding: "18px 20px 14px",
    borderBottom: "1px solid var(--ai4u-border-color)",
    flexShrink: 0,
  },
  title: { fontWeight: 700, fontSize: 15, color: "var(--ai4u-text-primary)" },
  subtitle: { fontSize: 12, color: "var(--ai4u-cadet-gray)", marginTop: 2 },
  closeBtn: {
    background: "transparent", border: "none", cursor: "pointer",
    color: "var(--ai4u-cadet-gray)", fontSize: 14, padding: "2px 4px",
    fontFamily: "inherit", lineHeight: 1,
  },
  body: { flex: 1, overflowY: "auto", padding: "12px 20px 20px" },
  center: { display: "flex", justifyContent: "center", padding: "40px 0" },
  entry: { marginBottom: 24 },
  entryHeader: {
    display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8,
  },
  entryVersion: {
    fontSize: 13, fontWeight: 700, color: "var(--ai4u-text-primary)",
    fontFamily: "'Necto Mono', monospace",
  },
  entryDate: { fontSize: 11, color: "var(--ai4u-cadet-gray)" },
  changeList: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 5 },
  changeItem: { display: "flex", alignItems: "baseline", gap: 8, fontSize: 13 },
  typeBadge: {
    fontFamily: "'Necto Mono', monospace", fontSize: 10, fontWeight: 700,
    flexShrink: 0, minWidth: 48,
  },
  changeText: { color: "var(--ai4u-text-secondary)", lineHeight: 1.5 },
}
