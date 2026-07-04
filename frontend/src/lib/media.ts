// Risolve l'URL della cover (entity_picture).
// In HA entity_picture è spesso un percorso relativo tipo /api/media_player_proxy/...
// che il browser non può caricare nel contesto ingress: lo passiamo dal proxy
// dell'addon (che ha il SUPERVISOR_TOKEN). Gli URL assoluti (CDN) restano invariati.
function ingressBase(): string {
  const { origin, pathname } = window.location
  const base = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname.replace(/\/[^/]*$/, '')
  return origin + base
}

export function artworkUrl(pic?: string | null): string | undefined {
  if (!pic) return undefined
  if (/^https?:\/\//i.test(pic)) return pic
  if (localStorage.getItem('ha-ll-use-proxy') === '1') {
    return ingressBase() + '/media-proxy?url=' + encodeURIComponent(pic)
  }
  return window.location.origin + pic
}
