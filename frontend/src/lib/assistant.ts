// Assistente Claude: add-on dello stesso repository (slug "<repo>_claude_assistant", o
// "local_claude_assistant" se installato a mano). Lo si cerca tramite il Supervisor
// (comando WS supervisor/api, solo amministratori): LD non ha bisogno di permessi in più.

type Send = <T = unknown>(msg: { type: string } & Record<string, unknown>) => Promise<T | null>

export interface AssistantAddon {
  slug: string
  /** percorso dell'ingress sulla stessa origine di HA, es. /api/hassio_ingress/<token>/ */
  ingressUrl: string
}

const SLUG = /(^|_)claude_assistant$/

export async function findAssistant(send: Send): Promise<AssistantAddon | null> {
  const list = await send<{ addons?: Array<{ slug: string; state?: string }> }>({ type: 'supervisor/api', endpoint: '/addons', method: 'get' })
  const found = (list?.addons ?? []).filter((a) => SLUG.test(a.slug))
  const addon = found.find((a) => a.state === 'started')
  if (!addon) return null
  // La risposta contiene anche le opzioni dell'add-on (compresa la chiave API): se ne tengono
  // solo i campi che servono, senza salvarla né registrarla.
  const info = await send<{ ingress?: boolean; ingress_url?: string | null; state?: string }>({ type: 'supervisor/api', endpoint: `/addons/${addon.slug}/info`, method: 'get' })
  if (!info?.ingress || !info.ingress_url || info.state !== 'started') return null
  return { slug: addon.slug, ingressUrl: info.ingress_url }
}

/** LD è servita dall'ingress di HA: stessa origine, il cookie di sessione ingress vale anche per l'Assistente. */
export function servedByIngress(): boolean {
  return window.location.pathname.startsWith('/api/hassio_ingress/')
}
