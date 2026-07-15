import { timingSafeEqual, createHash } from "crypto"

/**
 * Secreto interno compartido con mission-control-main. MISSION_CONTROL_SECRET
 * es el nombre canónico del ecosistema (usado por 22+ repos); MC_INTERNAL_SECRET
 * es un alias legacy que se acepta mientras se retira de Vercel.
 */
function candidates(): string[] {
  return [process.env.MISSION_CONTROL_SECRET, process.env.MC_INTERNAL_SECRET].filter(
    (s): s is string => Boolean(s)
  )
}

/** Compara en tiempo constante contra cualquiera de los secretos aceptados. */
export function verifyInternalSecret(received: string | null | undefined): boolean {
  if (!received) return false
  try {
    const receivedHash = createHash("sha256").update(received).digest()
    return candidates().some((expected) => {
      const expectedHash = createHash("sha256").update(expected).digest()
      return timingSafeEqual(receivedHash, expectedHash)
    })
  } catch {
    return false
  }
}

/** Secreto a mandar en llamadas salientes hacia mission-control-main (prefiere el nombre canónico). */
export function getOutgoingInternalSecret(): string | undefined {
  return candidates()[0]
}
