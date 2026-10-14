// Logger minimale su stdout (finisce nel registro dell'add-on). I segreti registrati con
// addSecret() vengono sostituiti prima della scrittura, così una chiave API non finisce mai nei log.
const secrets = new Set<string>()

export function addSecret(value: string | undefined): void {
  if (value && value.length >= 8) secrets.add(value)
}

export function redact(text: string): string {
  let out = text
  for (const s of secrets) out = out.split(s).join('[nascosto]')
  return out
}

function write(level: string, msg: string, extra?: unknown): void {
  const tail = extra === undefined ? '' : ' ' + (extra instanceof Error ? extra.message : safeJson(extra))
  process.stdout.write(redact(`${new Date().toISOString()} [${level}] ${msg}${tail}`) + '\n')
}

function safeJson(v: unknown): string {
  try { return JSON.stringify(v) } catch { return String(v) }
}

export const log = {
  info: (msg: string, extra?: unknown) => write('info', msg, extra),
  warn: (msg: string, extra?: unknown) => write('warn', msg, extra),
  error: (msg: string, extra?: unknown) => write('error', msg, extra),
}
