// Formato del QR credenziali: JSON compatto { t: token, u: urlInterno, e: urlEsterno }.
// Retrocompatibile: se il QR contiene solo una stringa (il token grezzo), la usa come token.

export interface Creds { token?: string; url?: string; externalUrl?: string }

export function parseCredsQR(text: string): Creds {
  const raw = text.trim()
  try {
    const o = JSON.parse(raw)
    if (o && typeof o === 'object') {
      const token = o.t ?? o.token
      const url = o.u ?? o.url
      const externalUrl = o.e ?? o.externalUrl
      if (token || url) {
        return {
          token: token ? String(token) : undefined,
          url: url ? String(url) : undefined,
          externalUrl: externalUrl ? String(externalUrl) : undefined,
        }
      }
    }
  } catch { /* non JSON: è il token grezzo */ }
  return { token: raw }
}

export function makeCredsQR(token: string, url?: string, externalUrl?: string): string {
  const o: Record<string, string> = { t: token }
  if (url) o.u = url
  if (externalUrl) o.e = externalUrl
  return JSON.stringify(o)
}
