"use client"

import { useEffect, useRef, useState } from "react"

interface Message {
  role: "user" | "assistant"
  content: string
}

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4100"

function getInitialApiKey(): string {
  if (typeof window === "undefined") return ""
  return new URLSearchParams(window.location.search).get("apiKey") ?? ""
}

export default function ChatPage() {
  const [apiKey] = useState(getInitialApiKey)

  if (!apiKey) {
    return (
      <main style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", background: "var(--ai4u-bg-default)", gap: 16, textAlign: "center", padding: 24 }}>
        <div style={{ fontSize: 32 }}>🔒</div>
        <div style={{ fontSize: 18, fontWeight: 600, color: "var(--ai4u-text-primary)" }}>Acceso restringido</div>
        <div style={{ fontSize: 14, color: "var(--ai4u-text-secondary)", maxWidth: 340 }}>
          Este asistente solo es accesible desde Mission Control.
        </div>
      </main>
    )
  }
  const [tenantName, setTenantName] = useState("")
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!apiKey) return
    fetch(`${BACKEND_URL}/api/v1/me`, { headers: { "X-API-Key": apiKey } })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setTenantName(data.name ?? data.tenant ?? "") })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, loading])

  async function sendMessage() {
    const text = input.trim()
    if (!text || loading) return
    setInput("")
    setError("")

    const next: Message[] = [...messages, { role: "user", content: text }]
    setMessages([...next, { role: "assistant", content: "" }])
    setLoading(true)

    try {
      const res = await fetch(`${BACKEND_URL}/api/v1/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify({ messages: next }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error ?? res.statusText)
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let accumulated = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        accumulated += decoder.decode(value, { stream: true })
        setMessages([...next, { role: "assistant", content: accumulated }])
      }

      if (!accumulated) accumulated = "(sin respuesta)"
      setMessages([...next, { role: "assistant", content: accumulated }])
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      setMessages(next)
    } finally {
      setLoading(false)
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <main style={styles.layout}>
      <header style={styles.header}>
        <span style={{ fontWeight: 600, fontSize: 16 }}>
          {tenantName ? `${tenantName} — SAP B1` : "SAP B1 — Asistente"}
        </span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--ai4u-cadet-gray)", fontFamily: "'Necto Mono', monospace" }}>{BACKEND_URL}</span>
          <button onClick={() => setMessages([])} style={styles.ghostBtn}>
            Nueva conversación
          </button>
        </div>
      </header>

      <div style={styles.messages}>
        {messages.length === 0 && (
          <div style={styles.empty}>
            <p style={{ fontSize: 15, color: "var(--ai4u-text-secondary)", marginBottom: 16 }}>
              Puedes preguntarme sobre datos en SAP, endpoints disponibles o pedirme indicadores.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
              {[
                "¿Cuál fue la facturación total de esta semana?",
                "Top 5 clientes por facturación en 2026",
                "Facturación por tecnología en mayo 2026",
                "¿Qué endpoints necesito para indicadores de ventas?",
              ].map((s) => (
                <button
                  key={s}
                  style={styles.suggestionBtn}
                  onClick={() => {
                    setInput(s)
                    textareaRef.current?.focus()
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} style={msg.role === "user" ? styles.userBubble : styles.aiBubble}>
            <div style={styles.bubbleLabel}>{msg.role === "user" ? "Tú" : "Asistente"}</div>
            <div style={styles.bubbleContent}>
              {msg.content ? (
                msg.role === "assistant" ? (
                  <MarkdownContent text={msg.content} />
                ) : (
                  msg.content
                )
              ) : loading && i === messages.length - 1 ? (
                <span style={{ color: "var(--ai4u-cadet-gray)" }}>Pensando…</span>
              ) : null}
            </div>
          </div>
        ))}

        {error && <div style={styles.errorBox}>Error: {error}</div>}
        <div ref={bottomRef} />
      </div>

      <div style={styles.inputArea}>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Escribe tu pregunta… (Ctrl+Enter para enviar)"
          rows={3}
          style={styles.textarea}
          disabled={loading}
        />
        <button
          onClick={sendMessage}
          disabled={loading || !input.trim()}
          style={{ ...styles.primaryBtn, alignSelf: "flex-end", minWidth: 90 }}
        >
          {loading ? "…" : "Enviar"}
        </button>
      </div>
    </main>
  )
}

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g
  let last = 0, m: RegExpExecArray | null, key = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith("`"))
      parts.push(<code key={key++} style={{ background: "var(--ai4u-gray-100)", borderRadius: 3, padding: "1px 5px", fontSize: 12, fontFamily: "'Necto Mono', monospace" }}>{tok.slice(1, -1)}</code>)
    else if (tok.startsWith("**"))
      parts.push(<strong key={key++}>{tok.slice(2, -2)}</strong>)
    else
      parts.push(<em key={key++}>{tok.slice(1, -1)}</em>)
    last = m.index + tok.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function MarkdownContent({ text }: { text: string }) {
  const lines = text.split("\n")
  const nodes: React.ReactNode[] = []
  let i = 0, key = 0

  while (i < lines.length) {
    const line = lines[i]

    // fenced code block
    if (line.startsWith("```")) {
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith("```")) { codeLines.push(lines[i]); i++ }
      nodes.push(
        <pre key={key++} style={{ background: "var(--ai4u-gray-100)", borderRadius: 6, padding: "10px 12px", margin: "8px 0", overflowX: "auto", fontSize: 12, fontFamily: "'Necto Mono', monospace" }}>
          <code>{codeLines.join("\n")}</code>
        </pre>
      )
      i++; continue
    }

    // table
    if (line.includes("|") && lines[i + 1]?.match(/^[\s|:-]+$/)) {
      const headers = line.split("|").map(c => c.trim()).filter(Boolean)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes("|")) {
        rows.push(lines[i].split("|").map(c => c.trim()).filter(Boolean))
        i++
      }
      nodes.push(
        <div key={key++} style={{ overflowX: "auto", margin: "8px 0" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}>
            <thead><tr>{headers.map((h, j) => <th key={j} style={{ border: "1px solid var(--ai4u-border-color)", padding: "6px 10px", background: "var(--ai4u-gray-100)", textAlign: "left", fontWeight: 600 }}>{renderInline(h)}</th>)}</tr></thead>
            <tbody>{rows.map((row, r) => <tr key={r}>{row.map((c, j) => <td key={j} style={{ border: "1px solid var(--ai4u-border-color)", padding: "6px 10px" }}>{renderInline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )
      continue
    }

    // heading
    const hm = line.match(/^(#{1,3}) (.+)/)
    if (hm) {
      const lvl = hm[1].length
      const s = lvl === 1 ? { fontSize: 16, fontWeight: 700, margin: "12px 0 6px" } : lvl === 2 ? { fontSize: 15, fontWeight: 700, margin: "12px 0 6px" } : { fontSize: 14, fontWeight: 700, margin: "10px 0 4px" }
      nodes.push(<div key={key++} style={s}>{renderInline(hm[2])}</div>)
      i++; continue
    }

    // hr
    if (line.match(/^---+$/)) {
      nodes.push(<hr key={key++} style={{ border: "none", borderTop: "1px solid var(--ai4u-border-color)", margin: "10px 0" }} />)
      i++; continue
    }

    // blockquote
    if (line.startsWith("> ")) {
      nodes.push(
        <blockquote key={key++} style={{ borderLeft: "3px solid var(--ai4u-border-color)", margin: "6px 0", paddingLeft: 12, color: "var(--ai4u-text-secondary)" }}>
          {renderInline(line.slice(2))}
        </blockquote>
      )
      i++; continue
    }

    // unordered list
    if (line.match(/^[-*] /)) {
      const items: React.ReactNode[] = []
      while (i < lines.length && lines[i].match(/^[-*] /)) {
        items.push(<li key={i} style={{ marginBottom: 2 }}>{renderInline(lines[i].slice(2))}</li>)
        i++
      }
      nodes.push(<ul key={key++} style={{ margin: "4px 0", paddingLeft: 20 }}>{items}</ul>)
      continue
    }

    // ordered list
    if (line.match(/^\d+\. /)) {
      const items: React.ReactNode[] = []
      while (i < lines.length && lines[i].match(/^\d+\. /)) {
        items.push(<li key={i} style={{ marginBottom: 2 }}>{renderInline(lines[i].replace(/^\d+\. /, ""))}</li>)
        i++
      }
      nodes.push(<ol key={key++} style={{ margin: "4px 0", paddingLeft: 20 }}>{items}</ol>)
      continue
    }

    // blank line
    if (line.trim() === "") { i++; continue }

    // paragraph
    nodes.push(<p key={key++} style={{ margin: "0 0 6px" }}>{renderInline(line)}</p>)
    i++
  }

  return <>{nodes}</>
}

const styles: Record<string, React.CSSProperties> = {
  layout: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    fontFamily: "var(--font-red-hat, 'Red Hat Display', system-ui, sans-serif)",
    background: "var(--ai4u-bg-default)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 20px",
    background: "var(--ai4u-bg-surface)",
    borderBottom: "1px solid var(--ai4u-border-color)",
    flexShrink: 0,
  },
  messages: {
    flex: 1,
    overflowY: "auto",
    padding: "20px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  empty: {
    maxWidth: 600,
    margin: "40px auto",
    textAlign: "center",
  },
  suggestionBtn: {
    background: "var(--ai4u-bg-surface)",
    border: "1px solid var(--ai4u-border-color)",
    borderRadius: 20,
    padding: "6px 14px",
    fontSize: 13,
    cursor: "pointer",
    color: "var(--ai4u-text-primary)",
    fontFamily: "inherit",
  },
  userBubble: {
    alignSelf: "flex-end",
    maxWidth: "75%",
    background: "var(--ai4u-black)",
    color: "var(--ai4u-white)",
    borderRadius: "16px 16px 4px 16px",
    padding: "12px 16px",
  },
  aiBubble: {
    alignSelf: "flex-start",
    maxWidth: "85%",
    background: "var(--ai4u-bg-surface)",
    border: "1px solid var(--ai4u-border-color)",
    borderRadius: "16px 16px 16px 4px",
    padding: "12px 16px",
  },
  bubbleLabel: {
    fontSize: 11,
    fontWeight: 600,
    opacity: 0.6,
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontFamily: "'Necto Mono', monospace",
  },
  bubbleContent: {
    fontSize: 14,
    lineHeight: 1.6,
    wordBreak: "break-word",
  },
  errorBox: {
    background: "rgba(255, 110, 0, 0.05)",
    border: "1px solid rgba(255, 110, 0, 0.30)",
    borderRadius: 8,
    padding: "10px 14px",
    color: "var(--ai4u-orange)",
    fontSize: 13,
  },
  inputArea: {
    display: "flex",
    gap: 10,
    padding: "14px 20px",
    background: "var(--ai4u-bg-surface)",
    borderTop: "1px solid var(--ai4u-border-color)",
    flexShrink: 0,
    alignItems: "flex-end",
  },
  textarea: {
    flex: 1,
    padding: "10px 14px",
    border: "1px solid var(--ai4u-border-color)",
    borderRadius: 10,
    fontSize: 14,
    resize: "none",
    fontFamily: "inherit",
    lineHeight: 1.5,
    outline: "none",
    background: "var(--ai4u-bg-default)",
    color: "var(--ai4u-text-primary)",
  },
  primaryBtn: {
    background: "var(--ai4u-black)",
    color: "var(--ai4u-white)",
    border: "none",
    borderRadius: 8,
    padding: "10px 18px",
    fontSize: 14,
    cursor: "pointer",
    fontWeight: 500,
    fontFamily: "inherit",
  },
  ghostBtn: {
    background: "transparent",
    color: "var(--ai4u-text-secondary)",
    border: "1px solid var(--ai4u-border-color)",
    borderRadius: 8,
    padding: "6px 12px",
    fontSize: 13,
    cursor: "pointer",
    fontFamily: "inherit",
  },
}
