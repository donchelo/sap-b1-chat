import type { ReactNode } from "react"

function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith("`"))
      parts.push(
        <code
          key={key++}
          style={{
            background: "var(--ai4u-gray-100)",
            borderRadius: 3,
            padding: "1px 5px",
            fontSize: 12,
            fontFamily: "'Necto Mono', monospace",
          }}
        >
          {tok.slice(1, -1)}
        </code>,
      )
    else if (tok.startsWith("**"))
      parts.push(<strong key={key++}>{tok.slice(2, -2)}</strong>)
    else parts.push(<em key={key++}>{tok.slice(1, -1)}</em>)
    last = m.index + tok.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

export function MarkdownContent({ text }: { text: string }) {
  const lines = text.split("\n")
  const nodes: ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.startsWith("```")) {
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i])
        i++
      }
      nodes.push(
        <pre
          key={key++}
          style={{
            background: "var(--ai4u-gray-100)",
            borderRadius: 6,
            padding: "10px 12px",
            margin: "8px 0",
            overflowX: "auto",
            fontSize: 12,
            fontFamily: "'Necto Mono', monospace",
          }}
        >
          <code>{codeLines.join("\n")}</code>
        </pre>,
      )
      i++
      continue
    }

    if (line.includes("|") && lines[i + 1]?.match(/^[\s|:-]+$/)) {
      const headers = line
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes("|")) {
        rows.push(
          lines[i]
            .split("|")
            .map((c) => c.trim())
            .filter(Boolean),
        )
        i++
      }
      nodes.push(
        <div key={key++} style={{ overflowX: "auto", margin: "8px 0" }}>
          <table
            style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}
          >
            <thead>
              <tr>
                {headers.map((h, j) => (
                  <th
                    key={j}
                    style={{
                      border: "1px solid var(--ai4u-border-color)",
                      padding: "6px 10px",
                      background: "var(--ai4u-gray-100)",
                      textAlign: "left",
                      fontWeight: 600,
                    }}
                  >
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {row.map((c, j) => (
                    <td
                      key={j}
                      style={{
                        border: "1px solid var(--ai4u-border-color)",
                        padding: "6px 10px",
                      }}
                    >
                      {renderInline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    const hm = line.match(/^(#{1,3}) (.+)/)
    if (hm) {
      const lvl = hm[1].length
      const s =
        lvl === 1
          ? { fontSize: 16, fontWeight: 700, margin: "12px 0 6px" }
          : lvl === 2
            ? { fontSize: 15, fontWeight: 700, margin: "12px 0 6px" }
            : { fontSize: 14, fontWeight: 700, margin: "10px 0 4px" }
      nodes.push(
        <div key={key++} style={s}>
          {renderInline(hm[2])}
        </div>,
      )
      i++
      continue
    }

    if (line.match(/^---+$/)) {
      nodes.push(
        <hr
          key={key++}
          style={{
            border: "none",
            borderTop: "1px solid var(--ai4u-border-color)",
            margin: "10px 0",
          }}
        />,
      )
      i++
      continue
    }

    if (line.startsWith("> ")) {
      nodes.push(
        <blockquote
          key={key++}
          style={{
            borderLeft: "3px solid var(--ai4u-border-color)",
            margin: "6px 0",
            paddingLeft: 12,
            color: "var(--ai4u-text-secondary)",
          }}
        >
          {renderInline(line.slice(2))}
        </blockquote>,
      )
      i++
      continue
    }

    if (line.match(/^[-*] /)) {
      const items: ReactNode[] = []
      while (i < lines.length && lines[i].match(/^[-*] /)) {
        items.push(
          <li key={i} style={{ marginBottom: 2 }}>
            {renderInline(lines[i].slice(2))}
          </li>,
        )
        i++
      }
      nodes.push(
        <ul key={key++} style={{ margin: "4px 0", paddingLeft: 20 }}>
          {items}
        </ul>,
      )
      continue
    }

    if (line.match(/^\d+\. /)) {
      const items: ReactNode[] = []
      while (i < lines.length && lines[i].match(/^\d+\. /)) {
        items.push(
          <li key={i} style={{ marginBottom: 2 }}>
            {renderInline(lines[i].replace(/^\d+\. /, ""))}
          </li>,
        )
        i++
      }
      nodes.push(
        <ol key={key++} style={{ margin: "4px 0", paddingLeft: 20 }}>
          {items}
        </ol>,
      )
      continue
    }

    if (line.trim() === "") {
      i++
      continue
    }

    nodes.push(
      <p key={key++} style={{ margin: "0 0 6px" }}>
        {renderInline(line)}
      </p>,
    )
    i++
  }

  return <>{nodes}</>
}
