import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  eslint: {
    // Lint corre como step propio en CI (npm run lint), no acoplado al build.
    // Antes de agregar eslint.config.mjs, `next build` no ejecutaba ESLint
    // (no había config); ahora sí lo hace por defecto y falla el build por
    // errores de lint preexistentes en el código (fuera de alcance de este cambio).
    ignoreDuringBuilds: true,
  },
}

export default nextConfig
