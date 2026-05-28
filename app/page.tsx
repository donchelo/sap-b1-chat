"use client"

import { useChat } from "@ai-sdk/react"
import {
  DefaultChatTransport,
  isTextUIPart,
  isToolUIPart,
  isReasoningUIPart,
  getToolName,
} from "ai"
import { useEffect, useMemo, useRef, useState } from "react"
import { MarkdownContent } from "./components/MarkdownContent"
import { ChangelogModal } from "./components/ChangelogModal"
import { useThreads, type Thread } from "./hooks/useThreads"
import { useSuggestions } from "./hooks/useSuggestions"

const APP_VERSION = "0.1.0"

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4100"

const TOOL_LABELS: Record<string, string> = {
  consultar_sql:       "Consultando SQL SAP",
  obtener_documento:   "Obteniendo documento",
  listar_registros:    "Listando registros",
  crear_documento:     "Preparando documento",
  actualizar_documento: "Actualizando documento",
  ejecutar_accion:     "Ejecutando acción",
}

// Context limit: Claude Sonnet 200k tokens. Alert zones:
const CTX_WARN  = 120_000
const CTX_LIMIT = 180_000

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

// Rough token estimate: ~4 chars per token
function estimateTokens(msgs: ReturnType<typeof useChat>["messages"]): number {
  return Math.round(
    msgs.reduce((sum, msg) =>
      sum + msg.parts.reduce((s, p) => s + (isTextUIPart(p) ? p.text.length : 60), 0)
    , 0) / 4
  )
}

// ─── Hook: cronómetro para tool calls pendientes ──────────────────────────────
function useElapsed(active: boolean): number {
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef<number | null>(null)
  useEffect(() => {
    if (!active) { startRef.current = null; setElapsed(0); return }
    startRef.current = Date.now()
    const id = setInterval(() => {
      if (startRef.current !== null) setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
    }, 500)
    return () => clearInterval(id)
  }, [active])
  return elapsed
}

// ─── TypingIndicator ──────────────────────────────────────────────────────────
function TypingIndicator() {
  return (
    <div className="ai-bubble">
      <div style={ss.bubbleLabel}>Asistente</div>
      <div className="typing-dots">
        <span /><span /><span />
      </div>
    </div>
  )
}

// ─── Root: gate de acceso ─────────────────────────────────────────────────────
export default function ChatPage() {
  const [apiKey, setApiKey] = useState("")
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setApiKey(getInitialApiKey())
    setMounted(true)
  }, [])

  if (!mounted) return null
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
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showChangelog, setShowChangelog] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-show changelog when the app version is newer than the last seen version
  useEffect(() => {
    const lastSeen = localStorage.getItem("changelog:lastSeen")
    if (lastSeen !== APP_VERSION) setShowChangelog(true)
  }, [])
  const bottomRef = useRef<HTMLDivElement>(null)

  const { suggestions, status: sugStatus, refresh: refreshSuggestions } =
    useSuggestions(apiKey, tenantName)

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
    () => new DefaultChatTransport({ api: "/api/chat", body: { apiKey } }),
    [apiKey],
  )

  const { messages, sendMessage, status, stop, setMessages, regenerate, error, clearError } =
    useChat({ transport })

  const isLoading = status === "submitted" || status === "streaming"
  const submittedElapsed = useElapsed(status === "submitted")

  const tokenEstimate = useMemo(() => estimateTokens(messages), [messages])

  // Último texto de data-status del backend para el status strip
  const liveStatusText = useMemo(() => {
    const lastMsg = [...messages].reverse().find(m => m.role === "assistant")
    if (!lastMsg) return undefined
    const sp = lastMsg.parts.filter(p => p.type === "data-status") as Array<{ type: string; data: { text: string } }>
    return sp.at(-1)?.data?.text
  }, [messages])

  const tokenColor =
    tokenEstimate > CTX_LIMIT ? "var(--ai4u-orange)" :
    tokenEstimate > CTX_WARN  ? "#d97706" :
    "var(--ai4u-cadet-gray)"

  const filteredThreads = search.trim()
    ? threads.filter((t) => t.title.toLowerCase().includes(search.toLowerCase()))
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
    setSidebarOpen(false)
  }

  function handleNewThread() {
    if (isLoading) stop()
    if (messages.length > 0 && activeThreadId) saveMessages(activeThreadId, messages)
    createThread()
    setSidebarOpen(false)
  }

  // Edit message: corta el historial al índice y pone el texto en el input
  function handleEditMessage(idx: number) {
    if (isLoading) return
    const msg = messages[idx]
    if (!msg || msg.role !== "user") return
    const text = msg.parts.filter(isTextUIPart).map((p) => p.text).join("")
    setMessages(messages.slice(0, idx))
    setInputValue(text)
    setTimeout(() => {
      textareaRef.current?.focus()
      const el = textareaRef.current
      if (el) { el.selectionStart = el.selectionEnd = el.value.length }
    }, 30)
  }

  return (
    <div className="chat-root">

      {showChangelog && (
        <ChangelogModal
          version={APP_VERSION}
          onClose={() => {
            localStorage.setItem("changelog:lastSeen", APP_VERSION)
            setShowChangelog(false)
          }}
        />
      )}

      {/* ── Backdrop móvil ──────────────────────────────────────── */}
      <div
        className={`sidebar-backdrop${sidebarOpen ? " is-open" : ""}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <aside className={`chat-sidebar${sidebarOpen ? " is-open" : ""}`}>
        <div style={ss.sidebarHeader}>
          <span style={{ fontWeight: 600, fontSize: 13, color: "var(--ai4u-text-primary)" }}>
            {tenantName || "SAP B1"}
          </span>
          <button onClick={handleNewThread} style={ss.newBtn} title="Nueva conversación">
            +
          </button>
        </div>

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
      <main className="chat-main">
        <header className="chat-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
            <button
              className="menu-btn"
              onClick={() => setSidebarOpen((v) => !v)}
              aria-label={sidebarOpen ? "Cerrar menú" : "Abrir menú"}
            >
              ☰
            </button>
            <span style={{ fontWeight: 600, fontSize: 15, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {activeThread?.title ?? "SAP B1 — Asistente"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            {/* Token indicator */}
            {messages.length > 0 && (
              <span style={{ fontSize: 11, color: tokenColor, fontFamily: "'Necto Mono', monospace" }}
                title={`~${tokenEstimate.toLocaleString()} tokens estimados de 200k`}>
                ~{tokenEstimate > 1000 ? `${Math.round(tokenEstimate / 1000)}k` : tokenEstimate}t
              </span>
            )}
            {activeThread && messages.length > 0 && (
              <button
                onClick={() => exportAsMarkdown({ ...activeThread, messages })}
                style={ss.ghostBtn}
                title="Exportar hilo como Markdown"
              >
                ↓ Exportar
              </button>
            )}
            <button
              onClick={() => setShowChangelog(true)}
              style={ss.versionBadge}
              title="Ver historial de cambios"
            >
              v{APP_VERSION}
            </button>
          </div>
        </header>

        {/* ── Barra de progreso indeterminada ─────────────────────── */}
        {isLoading && <div className="chat-progress-bar" />}

        <div className="chat-messages">
          {messages.length === 0 && status === "ready" && (
            <SuggestionsPanel
              suggestions={suggestions}
              loading={sugStatus === "loading"}
              tenantName={tenantName}
              onSelect={(s) => sendMessage({ text: s })}
              onRefresh={refreshSuggestions}
            />
          )}

          {messages.map((msg, idx) => {
            const isLastAssistant = idx === messages.length - 1 && msg.role === "assistant"
            const textParts = msg.parts.filter(isTextUIPart)
            const text = textParts.map((p) => p.text).join("")
            const showThinking = isLastAssistant && !text && status === "streaming"

            return (
              <MessageBubble
                key={msg.id}
                role={msg.role as "user" | "assistant"}
                parts={msg.parts}
                text={text}
                showThinking={showThinking}
                showRegen={isLastAssistant && !isLoading && !!text}
                onRegen={() => regenerate()}
                onEdit={msg.role === "user" ? () => handleEditMessage(idx) : undefined}
                isLoading={isLoading}
              />
            )
          })}

          {status === "submitted" && <TypingIndicator />}

          {error && (
            <div style={ss.errorBox}>
              <span style={{ flex: 1 }}>{error.message}</span>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button
                  onClick={() => { clearError(); regenerate() }}
                  style={{ ...ss.errorClose, fontWeight: 500 }}
                  title="Reintentar la última consulta"
                >
                  ↺ Reintentar
                </button>
                <button onClick={clearError} style={ss.errorClose}>✕</button>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* ── Status strip ────────────────────────────────────────── */}
        {isLoading && (
          <div style={ss.statusStrip}>
            <span style={{
              width: 6, height: 6, borderRadius: "50%", flexShrink: 0, display: "inline-block",
              background: status === "submitted" ? "var(--ai4u-orange)" : "var(--ai4u-blue)",
              animation: "pulse 1s ease-in-out infinite",
            }} />
            <span>
              {status === "submitted"
                ? submittedElapsed < 3  ? "Conectando al backend…"
                : submittedElapsed < 12 ? "Esperando respuesta de SAP B1…"
                : submittedElapsed < 35 ? `SAP B1 procesando… (${submittedElapsed}s)`
                : submittedElapsed < 70 ? `Consulta larga en SAP — puede tardar (${submittedElapsed}s)`
                :                         `Tiempo de espera alto (${submittedElapsed}s) — puedes cancelar`
                : liveStatusText ?? "Recibiendo respuesta…"}
            </span>
            <span style={{ marginLeft: "auto", opacity: 0.6 }}>
              Usa ■ Detener para cancelar
            </span>
          </div>
        )}

        <div className="chat-input-area">
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
            <button type="button" onClick={stop} style={{ ...ss.stopBtn, alignSelf: "flex-end", minWidth: 90 }}>
              ■ Detener
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

// ─── SuggestionsPanel ────────────────────────────────────────────────────────
function SuggestionsPanel({
  suggestions,
  loading,
  tenantName,
  onSelect,
  onRefresh,
}: {
  suggestions: string[]
  loading: boolean
  tenantName: string
  onSelect: (s: string) => void
  onRefresh: () => void
}) {
  return (
    <div style={ss.empty}>
      <p style={{ fontSize: 15, color: "var(--ai4u-text-secondary)", marginBottom: 4 }}>
        Preguntas estratégicas{tenantName ? ` para ${tenantName}` : ""}
      </p>
      <p style={{ fontSize: 12, color: "var(--ai4u-cadet-gray)", marginBottom: 16 }}>
        Generadas por IA · se actualizan cada día
      </p>
      {loading ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
          {[148, 112, 136, 124].map((w) => (
            <div key={w} style={{ width: w, height: 34, borderRadius: 20, background: "var(--ai4u-border-color)", animation: "pulse 1.4s ease-in-out infinite" }} />
          ))}
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
          {suggestions.map((s) => (
            <button key={s} style={ss.suggestionBtn} onClick={() => onSelect(s)}>{s}</button>
          ))}
        </div>
      )}
      <button onClick={onRefresh} disabled={loading} style={{ ...ss.microBtn, marginTop: 14, opacity: loading ? 0.4 : 1, cursor: loading ? "default" : "pointer" }}>
        {loading ? "Generando…" : "↺ Regenerar preguntas"}
      </button>
    </div>
  )
}

// ─── ToolCallStep ─────────────────────────────────────────────────────────────
function ToolCallStep({
  part,
  toolStatusText,
  onRetry,
}: {
  part: ReturnType<typeof useChat>["messages"][number]["parts"][number]
  toolStatusText?: string
  onRetry?: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  if (!isToolUIPart(part)) return null

  const name = getToolName(part)
  const label = TOOL_LABELS[name] ?? name
  const inv = part as unknown as {
    state: string
    input?: unknown
    output?: {
      sapDuration?: number
      error?: { code?: string; message?: string; retryable?: boolean }
      [k: string]: unknown
    }
    errorText?: string
  }

  const isDone    = inv.state === "output-available"
  const isError   = inv.state === "output-error"
  const isPending = !isDone && !isError
  const elapsed   = useElapsed(isPending)

  const sapDuration  = inv.output?.sapDuration
  const outputError  = inv.output?.error
  const isRetryable  = outputError?.retryable === true

  return (
    <div style={ss.toolStep}>
      <button
        style={ss.toolStepHeader}
        onClick={() => isDone && setExpanded((v) => !v)}
        disabled={!isDone}
      >
        <span style={{
          color: isError ? "var(--ai4u-orange)" : isDone ? "var(--ai4u-text-secondary)" : "var(--ai4u-cadet-gray)",
          animation: isPending ? "pulse 1.4s ease-in-out infinite" : undefined,
        }}>
          {isError ? "✗" : isDone ? "✓" : "●"}
        </span>
        <span style={{ flex: 1, textAlign: "left" as const }}>{label}</span>

        {/* Progreso en tiempo real (data-tool-status) */}
        {isPending && toolStatusText && (
          <span style={{ fontSize: 10, color: "var(--ai4u-cadet-gray)", fontStyle: "italic", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
            {toolStatusText}
          </span>
        )}

        {/* Cronómetro cuando no hay status text */}
        {isPending && !toolStatusText && elapsed > 0 && (
          <span style={{ fontSize: 10, color: "var(--ai4u-cadet-gray)", fontFamily: "'Necto Mono', monospace" }}>
            {elapsed}s
          </span>
        )}

        {/* Duración real SAP al completar */}
        {isDone && sapDuration !== undefined && (
          <span style={{ fontSize: 10, color: "var(--ai4u-cadet-gray)", fontFamily: "'Necto Mono', monospace" }}>
            · {(sapDuration / 1000).toFixed(1)}s SAP
          </span>
        )}

        {isDone && (
          <span style={{ fontSize: 10, color: "var(--ai4u-cadet-gray)" }}>
            {expanded ? "▲" : "▼"}
          </span>
        )}
      </button>

      {expanded && isDone && inv.output !== undefined && (
        <pre style={ss.toolOutput}>
          {typeof inv.output === "string" ? inv.output : JSON.stringify(inv.output, null, 2)}
        </pre>
      )}

      {isError && (
        <div style={{ ...ss.toolError, display: "flex", alignItems: "center", gap: 8 }}>
          <span>{outputError?.message ?? inv.errorText}</span>
          {isRetryable && onRetry && (
            <button onClick={onRetry} style={{ ...ss.microBtn, color: "var(--ai4u-orange)", flexShrink: 0 }}>
              ↺ Reintentar
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── ReasoningBlock ───────────────────────────────────────────────────────────
function ReasoningBlock({ text, streaming }: { text: string; streaming?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={ss.reasoningBlock}>
      <button style={ss.reasoningToggle} onClick={() => setOpen((v) => !v)}>
        <span style={{ color: "var(--ai4u-cadet-gray)", fontSize: 10 }}>{open ? "▲" : "▼"}</span>
        <span>Razonamiento</span>
        {streaming && (
          <span style={{ fontSize: 10, color: "var(--ai4u-cadet-gray)", animation: "pulse 1.4s ease-in-out infinite" }}>…</span>
        )}
      </button>
      {open && (
        <div style={ss.reasoningText}>{text}</div>
      )}
    </div>
  )
}

// ─── MessageBubble ────────────────────────────────────────────────────────────
function MessageBubble({
  role,
  parts,
  text,
  showThinking,
  showRegen,
  onRegen,
  onEdit,
  isLoading,
}: {
  role: "user" | "assistant"
  parts: ReturnType<typeof useChat>["messages"][number]["parts"]
  text: string
  showThinking: boolean
  showRegen: boolean
  onRegen: () => void
  onEdit?: () => void
  isLoading: boolean
}) {
  const [copied, setCopied] = useState(false)
  const [hovered, setHovered] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const toolParts = parts.filter(isToolUIPart)
  const reasoningParts = parts.filter(isReasoningUIPart)
  const toolStatusByCallId = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of parts) {
      if (p.type === "data-tool-status") {
        const d = (p as unknown as { data: { toolCallId: string; text: string } }).data
        if (d?.toolCallId && d?.text) map.set(d.toolCallId, d.text)
      }
    }
    return map
  }, [parts])

  // Último data-status dentro de este bubble (para reemplazar typing dots)
  const bubbleStatusText = useMemo(() => {
    const sp = parts.filter(p => p.type === "data-status") as Array<{ type: string; data: { text: string } }>
    return sp.at(-1)?.data?.text
  }, [parts])

  return (
    <div
      className={role === "user" ? "user-bubble" : "ai-bubble"}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={ss.bubbleLabel}>{role === "user" ? "Tú" : "Asistente"}</div>

      {/* Reasoning (extended thinking) */}
      {reasoningParts.map((p, i) => {
        if (!isReasoningUIPart(p)) return null
        return (
          <ReasoningBlock
            key={i}
            text={p.text}
            streaming={p.state === "streaming"}
          />
        )
      })}

      {/* Tool calls */}
      {toolParts.length > 0 && (
        <div style={ss.toolStepList}>
          {toolParts.map((p, i) => {
            const callId = (p as unknown as { toolCallId?: string }).toolCallId ?? ""
            return (
              <ToolCallStep
                key={i}
                part={p}
                toolStatusText={toolStatusByCallId.get(callId)}
                onRetry={onRegen}
              />
            )
          })}
        </div>
      )}

      {/* Main text */}
      <div style={ss.bubbleContent}>
        {role === "assistant" ? (
          showThinking ? (
            bubbleStatusText
              ? <span style={{ color: "var(--ai4u-cadet-gray)", fontStyle: "italic", fontSize: 13 }}>{bubbleStatusText}</span>
              : <div className="typing-dots"><span /><span /><span /></div>
          ) : (
            <MarkdownContent text={text} />
          )
        ) : (
          text
        )}
      </div>

      {/* Actions */}
      {text && (
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <button onClick={copy} style={ss.microBtn}>
            {copied ? "✓ Copiado" : "Copiar"}
          </button>
          {showRegen && (
            <button onClick={onRegen} style={ss.microBtn}>↺ Regenerar</button>
          )}
          {role === "user" && onEdit && (hovered || isLoading === false) && (
            <button onClick={onEdit} style={ss.microBtn} title="Editar y regenerar desde este punto">
              ✎ Editar
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── ThreadItem ───────────────────────────────────────────────────────────────
function ThreadItem({
  thread, isActive, onSelect, onDelete, onRename,
}: {
  thread: Thread; isActive: boolean; onSelect: () => void; onDelete: () => void; onRename: (t: string) => void
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
      style={{ ...ss.threadItem, background: isActive ? "var(--ai4u-bg-default)" : hovered ? "rgba(0,0,0,0.03)" : "transparent" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {editing ? (
        <input ref={inputRef} value={editValue} onChange={(e) => setEditValue(e.target.value)} onBlur={commitEdit} onKeyDown={handleEditKey} style={ss.renameInput} />
      ) : (
        <button onClick={onSelect} onDoubleClick={startEdit} style={ss.threadBtn}>
          <span style={ss.threadTitle}>{thread.title}</span>
          <span style={ss.threadTime}>{relativeTime(thread.updatedAt)}</span>
        </button>
      )}
      {!editing && (isActive || hovered) && (
        <button onClick={(e) => { e.stopPropagation(); onDelete() }} style={ss.deleteBtn} title="Eliminar hilo">✕</button>
      )}
    </div>
  )
}

// ─── Estilos ───────────────────────────────────────────────────────────────────
const ss: Record<string, React.CSSProperties> = {
  lockScreen: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100dvh", background: "var(--ai4u-bg-default)", gap: 16, textAlign: "center", padding: 24 },

  // Sidebar
  sidebarHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 14px 10px", borderBottom: "1px solid var(--ai4u-border-color)", flexShrink: 0 },
  newBtn: { background: "var(--ai4u-black)", color: "var(--ai4u-white)", border: "none", borderRadius: 6, width: 28, height: 28, fontSize: 18, lineHeight: "1", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" },
  searchInput: { width: "100%", padding: "6px 10px", border: "1px solid var(--ai4u-border-color)", borderRadius: 8, fontSize: 12, background: "var(--ai4u-bg-default)", color: "var(--ai4u-text-primary)", fontFamily: "inherit", outline: "none", boxSizing: "border-box" as const },
  threadList: { flex: 1, overflowY: "auto", padding: "6px 8px" },
  threadItem: { display: "flex", alignItems: "center", borderRadius: 8, marginBottom: 2, transition: "background 0.1s" },
  threadBtn: { flex: 1, background: "transparent", border: "none", cursor: "pointer", padding: "8px 8px", textAlign: "left" as const, fontFamily: "inherit", display: "flex", flexDirection: "column" as const, gap: 2, minWidth: 0 },
  threadTitle: { fontSize: 13, color: "var(--ai4u-text-primary)", whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis", display: "block", maxWidth: 180 },
  threadTime: { fontSize: 11, color: "var(--ai4u-cadet-gray)" },
  renameInput: { flex: 1, margin: "4px 6px", padding: "4px 8px", border: "1px solid var(--ai4u-border-color)", borderRadius: 6, fontSize: 13, fontFamily: "inherit", outline: "none", background: "var(--ai4u-bg-default)", color: "var(--ai4u-text-primary)" },
  deleteBtn: { background: "transparent", border: "none", cursor: "pointer", color: "var(--ai4u-cadet-gray)", fontSize: 12, padding: "4px 8px", borderRadius: 4, flexShrink: 0, fontFamily: "inherit" },

  // Chat
  empty: { maxWidth: 560, margin: "40px auto", textAlign: "center" },
  suggestionBtn: { background: "var(--ai4u-bg-surface)", border: "1px solid var(--ai4u-border-color)", borderRadius: 20, padding: "6px 14px", fontSize: 13, cursor: "pointer", color: "var(--ai4u-text-primary)", fontFamily: "inherit" },
  bubbleLabel: { fontSize: 11, fontWeight: 600, opacity: 0.6, marginBottom: 4, textTransform: "uppercase" as const, letterSpacing: "0.08em", fontFamily: "'Necto Mono', monospace" },
  bubbleContent: { fontSize: 14, lineHeight: 1.6, wordBreak: "break-word" as const },
  microBtn: { background: "transparent", border: "none", color: "var(--ai4u-cadet-gray)", fontSize: 11, cursor: "pointer", padding: "2px 0", fontFamily: "inherit" },
  errorBox: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255,110,0,0.05)", border: "1px solid rgba(255,110,0,0.30)", borderRadius: 8, padding: "10px 14px", color: "var(--ai4u-orange)", fontSize: 13, gap: 8 },
  errorClose: { background: "transparent", border: "none", color: "var(--ai4u-orange)", cursor: "pointer", fontSize: 13, padding: 0, fontFamily: "inherit", flexShrink: 0 },
  textarea: { flex: 1, padding: "10px 14px", border: "1px solid var(--ai4u-border-color)", borderRadius: 10, fontSize: 14, resize: "none" as const, fontFamily: "inherit", lineHeight: 1.5, outline: "none", background: "var(--ai4u-bg-default)", color: "var(--ai4u-text-primary)", overflow: "hidden" },
  primaryBtn: { background: "var(--ai4u-black)", color: "var(--ai4u-white)", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 14, cursor: "pointer", fontWeight: 500, fontFamily: "inherit" },
  ghostBtn: { background: "transparent", color: "var(--ai4u-text-secondary)", border: "1px solid var(--ai4u-border-color)", borderRadius: 8, padding: "6px 12px", fontSize: 13, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" as const },
  stopBtn: { background: "rgba(255,110,0,0.08)", color: "var(--ai4u-orange)", border: "1px solid rgba(255,110,0,0.30)", borderRadius: 8, padding: "10px 18px", fontSize: 14, cursor: "pointer", fontWeight: 500, fontFamily: "inherit", whiteSpace: "nowrap" as const },
  statusStrip: { display: "flex", alignItems: "center", gap: 7, padding: "5px 20px", fontSize: 11, color: "var(--ai4u-cadet-gray)", background: "var(--ai4u-bg-surface)", borderTop: "1px solid var(--ai4u-border-color)", flexShrink: 0 },
  versionBadge: { background: "transparent", color: "var(--ai4u-cadet-gray)", border: "1px solid var(--ai4u-border-color)", borderRadius: 6, padding: "3px 8px", fontSize: 11, cursor: "pointer", fontFamily: "'Necto Mono', monospace", whiteSpace: "nowrap" as const, flexShrink: 0 },

  // Tool steps
  toolStepList: { display: "flex", flexDirection: "column" as const, gap: 4, marginBottom: 10, borderLeft: "2px solid var(--ai4u-border-color)", paddingLeft: 10 },
  toolStep: { fontSize: 12, color: "var(--ai4u-text-secondary)" },
  toolStepHeader: { display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12, color: "var(--ai4u-text-secondary)", padding: "3px 0", width: "100%", textAlign: "left" as const },
  toolOutput: { fontSize: 11, fontFamily: "monospace", background: "rgba(0,0,0,0.04)", borderRadius: 6, padding: "8px 10px", overflowX: "auto" as const, maxHeight: 200, overflowY: "auto" as const, marginTop: 4, color: "var(--ai4u-text-secondary)" },
  toolError: { fontSize: 11, color: "var(--ai4u-orange)", marginTop: 4, paddingLeft: 4 },

  // Reasoning / thinking
  reasoningBlock: { marginBottom: 8, borderRadius: 8, border: "1px solid var(--ai4u-border-color)", overflow: "hidden" },
  reasoningToggle: { display: "flex", alignItems: "center", gap: 6, width: "100%", background: "rgba(0,0,0,0.02)", border: "none", cursor: "pointer", padding: "6px 10px", fontSize: 11, color: "var(--ai4u-text-secondary)", fontFamily: "inherit", textAlign: "left" as const },
  reasoningText: { fontSize: 12, lineHeight: 1.6, color: "var(--ai4u-text-secondary)", padding: "8px 10px", whiteSpace: "pre-wrap" as const, maxHeight: 300, overflowY: "auto" as const },
}
