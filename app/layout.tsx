import type { Metadata } from "next"
import { Red_Hat_Display } from "next/font/google"
import "@ai4u/design-system/styles"
import "./globals.css"
import { ChangelogPill } from "@/components/ChangelogPill"

const redHatDisplay = Red_Hat_Display({
  subsets: ["latin"],
  weight: ["300", "400", "500", "700", "900"],
  variable: "--font-red-hat",
  display: "swap",
})

export const metadata: Metadata = {
  title: "SAP B1 — Asistente AI4U",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={redHatDisplay.variable}>
      <body style={{ margin: 0, padding: 0 }}>
        {children}
        <ChangelogPill />
      </body>
    </html>
  )
}
