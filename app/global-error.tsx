"use client"

import { useEffect } from "react"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[global-error]", error)
  }, [error])

  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          fontFamily: "sans-serif",
          textAlign: "center",
          padding: "1rem",
          background: "#fff",
          color: "#111",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "0.5rem" }}>
          Error inesperado
        </h1>
        <p style={{ color: "#555", marginBottom: "1.5rem", maxWidth: 400 }}>
          La aplicación encontró un problema. Por favor recarga la página.
        </p>
        {error.digest && (
          <p style={{ fontSize: "0.75rem", color: "#999", marginBottom: "1rem", fontFamily: "monospace" }}>
            Código: {error.digest}
          </p>
        )}
        <button
          onClick={reset}
          style={{
            padding: "0.5rem 1.5rem",
            background: "#1976d2",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "1rem",
          }}
        >
          Reintentar
        </button>
      </body>
    </html>
  )
}
