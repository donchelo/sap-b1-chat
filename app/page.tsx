"use client"

import { useChat } from "@ai-sdk/react"
import { isTextUIPart, TextStreamChatTransport } from "ai"
import { useEffect, useMemo, useRef, useState } from "react"
import { MarkdownContent } from "./components/MarkdownContent"
import { useThreads, type Thread } from "./hooks/useThreads"
import { useSuggestions } from "./hooks/useSuggestions"

// ─── Chatbot fundamentals — resumen ──────────────────────────────────────────
//  Tier 1  Streaming · historial · error handling · stop · fix hooks
//  Tier 2  Auto-resize textarea · Detener btn · Pensando… · Regenerar
//  Tier 3  Multi-hilo localStorage · título auto · switching · eliminar
//  Tier 4  Búsqueda en hilos · Rename inline · Copy message · Export .md
//  Tier 5  Preguntas estratégicas auto-generadas por LLM (cache diaria)
// ─────────────────────────────────────────────────────────────────────────────

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4100"

function getInitialApiKey(): string {
  if (typeof window === "undefined") return ""
  return new URLSearchParams(window.location.search).get("apiKey") ?? ""
}

function relativeTime(ts: number): string {
  const min = Math.floor((Date.now() - ts) / 60000)
  if (min < 1) return "ahora"
  if (min < 60) return `${min}m`
  const hrs = Math.floor(min / 60)
  if (hrs < 24) return `${hrs}h`
  return new Date(ts).toLocaleDateString("es", { month: "short", day: "numeric" })
}

// Descarga el hilo activo como archivo Markdown (Tier 4 — 100% frontend)
function exportAsMarkdown(thread: Thread) {
  const sections = thread.messages.map((msg) => {
    const text = msg.parts.filter(isTextUIPart).map((p) => p.text).join("")
    const label = msg.role === "user" ? "**Usuario**" : "**Asistente**"
    return `${label}\n\n${text}`
  })
  const md = `# ${thread.title}\n\n${sections.join("\n\n---\n\n")}`
  const blob = new Blob([md], { type: "text/markdown; charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${thread.title.slice(0, 48).replace(/[^\w\s-]/g, "")}.md`
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Root: sólo gate de acceso ────────────────────────────────────────────────
export default function ChatPage() {
  const [apiKey] = useState(getInitialApiKey)

  if (!apiKey) {
    return (
      <main style={ss.lockScreen}>
        <div style={{ fontSize: 32 }}>🔒</div>
        <div style={{ fontSize: 18, fontWeight: 600, color: "var(--ai4u-text-primary)" }}>
          Acceso restringido
        </div>
        <div style={{ fontSize: 14, color: "var(--ai4u-text-secondary)", maxWidth: 340 }}>
          Este asistente solo es accesible desde Mission Control.
        </div>
      </main>
    )
  }

  return <ChatUI apiKey={apiKey} />
}

// ─── ChatUI ───────────────────────────────────────────────────────────────────
function ChatUI({ apiKey }: { apiKey: string }) {
  const [tenantName, setTenantName] = useState("")
  const [inputValue, setInputValue] = useState("")
  const [search, setSearch] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Tier 5: preguntas estratégicas auto-generadas
  const { suggestions, status: sugStatus, refresh: refreshSuggestions } =
    useSuggestions(apiKey)

  const {
    threads,
    activeThreadId,
    activeThread,
    setActiveThreadId,
    createThread,
    saveMessages,
    deleteThread,
    renameThread,
  } = useThreads()

  const transport = useMemo(
    () => new TextStreamChatTransport({ api: "/api/chat", body: { apiKey } }),
    [apiKey],
  )

  const { messages, sendMessage, status, stop, setMessages, regenerate, error, clearError } =
    useChat({ transport })

  const isLoading = status === "submitted" || status === "streaming"

  // Filtro de búsqueda (Tier 4) — busca en título y primer mensaje
  const filteredThreads = search.trim()
    ? threads.filter((t) =>
        t.title.toLowerCase().includes(search.toLowerCase()),
      )
    : threads

  // Cargar mensajes al cambiar de hilo
  useEffect(() => {
    if (!activeThread) return
    setMessages(activeThread.messages)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThread?.id])

  // Guardar en localStorage cuando termina el streaming
  useEffect(() => {
    if (status === "ready" && messages.length > 0 && activeThreadId) {
      saveMessages(activeThreadId, messages)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  // Nombre del tenant
  useEffect(() => {
    fetch(`${BACKEND_URL}/api/v1/me`, { headers: { "X-API-Key": apiKey } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setTenantName(d.name ?? d.tenant ?? "") })
      .catch(() => {})
  }, [apiKey])

  // Scroll al último mensaje
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, status])

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [inputValue])

  function handleSend() {
    const text = inputValue.trim()
    if (!text || isLoading) return
    clearError()
    setInputValue("")
    sendMessage({ text })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleSend()
    }
  }

  function switchThread(threadId: string) {
    if (isLoading) stop()
    if (messages.length > 0 && activeThreadId) saveMessages(activeThreadId, messages)
    setActiveThreadId(threadId)
  }

  function handleNewThread() {
    if (isLoading) stop()
    if (messages.length > 0 && activeThreadId) saveMessages(activeThreadId, messages)
    createThread()
  }

  return (
    <div style={ss.root}>

      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <aside style={ss.sidebar}>
        <div style={ss.sidebarHeader}>
          <span style={{ fontWeight: 600, fontSize: 13, color: "var(--ai4u-text-primary)" }}>
            {tenantName || "SAP B1"}
          </span>
          <button onClick={handleNewThread} style={ss.newBtn} title="Nueva conversación">
            +
          </button>
        </div>

        {/* Búsqueda (Tier 4) */}
        <div style={{ padding: "8px 10px 4px" }}>
          <input
            type="search"
            placeholder="Buscar hilo…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={ss.searchInput}
          />
        </div>

        <div style={ss.threadList}>
          {filteredThreads.length === 0 && (
            <p style={{ fontSize: 12, color: "var(--ai4u-cadet-gray)", padding: "8px 10px" }}>
              Sin resultados
            </p>
          )}
          {filteredThreads.map((thread) => (
            <ThreadItem
              key={thread.id}
              thread={thread}
              isActive={thread.id === activeThreadId}
              onSelect={() => switchThread(thread.id)}
              onDelete={() => deleteThread(thread.id)}
              onRename={(title) => renameThread(thread.id, title)}
            />
          ))}
        </div>
      </aside>

      {/* ── Área de chat ─────────────────────────────────────────── */}
      <main style={ss.chat}>
        <header style={ss.header}>
          <span style={{ fontWeight: 600, fontSize: 15, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {activeThread?.title ?? "SAP B1 — Asistente"}
          </span>
          {/* Export (Tier 4) */}
          {activeThread && messages.length > 0 && (
            <button
              onClick={() => exportAsMarkdown({ ...activeThread, messages })}
              style={ss.ghostBtn}
              title="Exportar hilo como Markdown"
            >
              ↓ Exportar
            </button>
          )}
        </header>

        <div style={ss.messages}>
          {messages.length === 0 && status === "ready" && (
            <SuggestionsPanel
              suggestions={suggestions}
              loading={sugStatus === "loading"}
              onSelect={(s) => sendMessage({ text: s })}
              onRefresh={refreshSuggestions}
            />
          )}

          {messages.map((msg, idx) => {
            const text = msg.parts.filter(isTextUIPart).map((p) => p.text).join("")
            const isLastAssistant = idx === messages.length - 1 && msg.role === "assistant"
            const showThinking = isLastAssistant && !text && status === "streaming"

            return (
              <MessageBubble
                key={msg.id}
                role={msg.role as "user" | "assistant"}
                text={text}
                showThinking={showThinking}
                showRegen={isLastAssistant && !isLoading && !!text}
                onRegen={() => regenerate()}
              />
            )
          })}

          {status === "submitted" && (
            <div style={ss.aiBubble}>
              <div style={ss.bubbleLabel}>Asistente</div>
              <div style={ss.bubbleContent}>
                <span style={{ color: "var(--ai4u-cadet-gray)" }}>Pensando…</span>
              </div>
            </div>
          )}

          {error && (
            <div style={ss.errorBox}>
              {error.message}
              <button onClick={clearError} style={ss.errorClose}>✕</button>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        <div style={ss.inputArea}>
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Escribe tu pregunta… (Ctrl+Enter para enviar)"
            rows={1}
            style={ss.textarea}
            disabled={isLoading}
          />
          {isLoading ? (
            <button type="button" onClick={stop} style={{ ...ss.ghostBtn, alignSelf: "flex-end", minWidth: 90 }}>
              Detener
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={!inputValue.trim()}
              style={{ ...ss.primaryBtn, alignSelf: "flex-end", minWidth: 90 }}
            >
              Enviar
            </button>
          )}
        </div>
      </main>
    </div>
  )
}

// ─── SuggestionsPanel (Tier 5: preguntas estratégicas auto-generadas) ────────
function SuggestionsPanel({
  suggestions,
  loading,
  onSelect,
  onRefresh,
}: {
  suggestions: string[]
  loading: boolean
  onSelect: (s: string) => void
  onRefresh: () => void
}) {
  return (
    <div style={ss.empty}>
      <p style={{ fontSize: 15, color: "var(--ai4u-text-secondary)", marginBottom: 4 }}>
        Preguntas estratégicas para Tamaprint
      </p>
      <p style={{ fontSize: 12, color: "var(--ai4u-cadet-gray)", marginBottom: 16 }}>
        Generadas por IA · se actualizan cada día
      </p>

      {loading ? (
        /* Skeleton mientras el LLM genera */
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
          {[148, 112, 136, 124].map((w) => (
            <div
              key={w}
              style={{
                width: w,
                height: 34,
                borderRadius: 20,
                background: "var(--ai4u-border-color)",
                animation: "pulse 1.4s ease-in-out infinite",
              }}
            />
          ))}
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
          {suggestions.map((s) => (
            <button key={s} style={ss.suggestionBtn} onClick={() => onSelect(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      <button
        onClick={onRefresh}
        disabled={loading}
        style={{
          ...ss.microBtn,
          marginTop: 14,
          opacity: loading ? 0.4 : 1,
          cursor: loading ? "default" : "pointer",
        }}
      >
        {loading ? "Generando…" : "↺ Regenerar preguntas"}
      </button>
    </div>
  )
}

// ─── MessageBubble (Tier 4: botón copy por burbuja) ──────────────────────────
function MessageBubble({
  role,
  text,
  showThinking,
  showRegen,
  onRegen,
}: {
  role: "user" | "assistant"
  text: string
  showThinking: boolean
  showRegen: boolean
  onRegen: () => void
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div style={role === "user" ? ss.userBubble : ss.aiBubble}>
      <div style={ss.bubbleLabel}>{role === "user" ? "Tú" : "Asistente"}</div>
      <div style={ss.bubbleContent}>
        {role === "assistant" ? (
          showThinking ? (
            <span style={{ color: "var(--ai4u-cadet-gray)" }}>Pensando…</span>
          ) : (
            <MarkdownContent text={text} />
          )
        ) : (
          text
        )}
      </div>
      {text && (
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <button onClick={copy} style={ss.microBtn}>
            {copied ? "✓ Copiado" : "Copiar"}
          </button>
          {showRegen && (
            <button onClick={onRegen} style={ss.microBtn}>
              ↺ Regenerar
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── ThreadItem (Tier 4: rename inline con doble-click) ──────────────────────
function ThreadItem({
  thread,
  isActive,
  onSelect,
  onDelete,
  onRename,
}: {
  thread: Thread
  isActive: boolean
  onSelect: () => void
  onDelete: () => void
  onRename: (title: string) => void
}) {
  const [hovered, setHovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(thread.title)
  const inputRef = useRef<HTMLInputElement>(null)

  function startEdit(e: React.MouseEvent) {
    e.stopPropagation()
    setEditValue(thread.title)
    setEditing(true)
    setTimeout(() => { inputRef.current?.select() }, 10)
  }

  function commitEdit() {
    setEditing(false)
    onRename(editValue)
  }

  function handleEditKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") commitEdit()
    if (e.key === "Escape") setEditing(false)
  }

  return (
    <div
      style={{
        ...ss.threadItem,
        background: isActive
          ? "var(--ai4u-bg-default)"
          : hovered
            ? "rgba(0,0,0,0.03)"
            : "transparent",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {editing ? (
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleEditKey}
          style={ss.renameInput}
        />
      ) : (
        <button onClick={onSelect} onDoubleClick={startEdit} style={ss.threadBtn}>
          <span style={ss.threadTitle}>{thread.title}</span>
          <span style={ss.threadTime}>{relativeTime(thread.updatedAt)}</span>
        </button>
      )}

      {!editing && (isActive || hovered) && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          style={ss.deleteBtn}
          title="Eliminar hilo"
        >
          ✕
        </button>
      )}
    </div>
  )
}

// ─── Estilos ───────────────────────────────────────────────────────────────────
const ss: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    height: "100vh",
    fontFamily: "var(--font-red-hat, 'Red Hat Display', system-ui, sans-serif)",
    background: "var(--ai4u-bg-default)",
  },
  lockScreen: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: "100vh",
    background: "var(--ai4u-bg-default)",
    gap: 16,
    textAlign: "center",
    padding: 24,
  },

  // Sidebar
  sidebar: {
    width: 260,
    flexShrink: 0,
    background: "var(--ai4u-bg-surface)",
    borderRight: "1px solid var(--ai4u-border-color)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  sidebarHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "14px 14px 10px",
    borderBottom: "1px solid var(--ai4u-border-color)",
    flexShrink: 0,
  },
  newBtn: {
    background: "var(--ai4u-black)",
    color: "var(--ai4u-white)",
    border: "none",
    borderRadius: 6,
    width: 28,
    height: 28,
    fontSize: 18,
    lineHeight: "1",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "inherit",
  },
  searchInput: {
    width: "100%",
    padding: "6px 10px",
    border: "1px solid var(--ai4u-border-color)",
    borderRadius: 8,
    fontSize: 12,
    background: "var(--ai4u-bg-default)",
    color: "var(--ai4u-text-primary)",
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box" as const,
  },
  threadList: {
    flex: 1,
    overflowY: "auto",
    padding: "6px 8px",
  },
  threadItem: {
    display: "flex",
    alignItems: "center",
    borderRadius: 8,
    marginBottom: 2,
    transition: "background 0.1s",
  },
  threadBtn: {
    flex: 1,
    background: "transparent",
    border: "none",
    cursor: "pointer",
    padding: "8px 8px",
    textAlign: "left" as const,
    fontFamily: "inherit",
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
    minWidth: 0,
  },
  threadTitle: {
    fontSize: 13,
    color: "var(--ai4u-text-primary)",
    whiteSpace: "nowrap" as const,
    overflow: "hidden",
    textOverflow: "ellipsis",
    display: "block",
    maxWidth: 180,
  },
  threadTime: {
    fontSize: 11,
    color: "var(--ai4u-cadet-gray)",
  },
  renameInput: {
    flex: 1,
    margin: "4px 6px",
    padding: "4px 8px",
    border: "1px solid var(--ai4u-border-color)",
    borderRadius: 6,
    fontSize: 13,
    fontFamily: "inherit",
    outline: "none",
    background: "var(--ai4u-bg-default)",
    color: "var(--ai4u-text-primary)",
  },
  deleteBtn: {
    background: "transparent",
    border: "none",
    cursor: "pointer",
    color: "var(--ai4u-cadet-gray)",
    fontSize: 12,
    padding: "4px 8px",
    borderRadius: 4,
    flexShrink: 0,
    fontFamily: "inherit",
  },

  // Chat
  chat: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
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
    maxWidth: 560,
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
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    fontFamily: "'Necto Mono', monospace",
  },
  bubbleContent: {
    fontSize: 14,
    lineHeight: 1.6,
    wordBreak: "break-word" as const,
  },
  microBtn: {
    background: "transparent",
    border: "none",
    color: "var(--ai4u-cadet-gray)",
    fontSize: 11,
    cursor: "pointer",
    padding: "2px 0",
    fontFamily: "inherit",
  },
  errorBox: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "rgba(255,110,0,0.05)",
    border: "1px solid rgba(255,110,0,0.30)",
    borderRadius: 8,
    padding: "10px 14px",
    color: "var(--ai4u-orange)",
    fontSize: 13,
    gap: 8,
  },
  errorClose: {
    background: "transparent",
    border: "none",
    color: "var(--ai4u-orange)",
    cursor: "pointer",
    fontSize: 13,
    padding: 0,
    fontFamily: "inherit",
    flexShrink: 0,
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
    resize: "none" as const,
    fontFamily: "inherit",
    lineHeight: 1.5,
    outline: "none",
    background: "var(--ai4u-bg-default)",
    color: "var(--ai4u-text-primary)",
    overflow: "hidden",
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
    whiteSpace: "nowrap" as const,
  },
}
