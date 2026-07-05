// Kiosk: nasconde l'header del pannello di Home Assistant attorno all'ingress.
// L'ingress è same-origin: dall'iframe raggiungiamo il documento padre e iniettiamo
// uno <style> in ogni shadow root che contiene un header. Iniettare stile (anziché
// toccare i singoli elementi) resiste ai re-render di HA.

const STYLE_ID = 'ld-kiosk-style'
const KIOSK_CSS = `
  .mdc-top-app-bar,
  app-header,
  .header,
  .toolbar { display: none !important; }
  .mdc-top-app-bar--fixed-adjust { padding-top: 0 !important; }
  :host { --header-height: 0px !important; }
`

let kioskTimer: ReturnType<typeof setInterval> | null = null

function parentDoc(): Document | null {
  try {
    const d = window.parent?.document
    return d && d !== document ? d : null
  } catch {
    return null
  }
}

export function kioskAvailable(): boolean {
  return parentDoc() !== null
}

function walkRoots(pdoc: Document, cb: (root: Document | ShadowRoot) => void): void {
  const visit = (root: Document | ShadowRoot, depth: number) => {
    if (depth > 16) return
    cb(root)
    const els = root.querySelectorAll('*')
    for (let i = 0; i < els.length; i++) {
      const sr = (els[i] as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot
      if (sr) visit(sr, depth + 1)
    }
  }
  visit(pdoc, 0)
}

function applyOnce(hidden: boolean): boolean {
  const pdoc = parentDoc()
  if (!pdoc) return false
  let touched = 0
  walkRoots(pdoc, (root) => {
    const hasHeader = root.querySelector('.mdc-top-app-bar, app-header, .header, .toolbar, ha-menu-button')
    const existing = root.querySelector(`#${STYLE_ID}`)
    if (hidden) {
      if (hasHeader && !existing) {
        const style = pdoc.createElement('style')
        style.id = STYLE_ID
        style.textContent = KIOSK_CSS
        const target = root instanceof Document ? root.head : root
        target.appendChild(style)
        touched += 1
      }
    } else if (existing) {
      existing.remove()
      touched += 1
    }
    // Allunga l'iframe ingress a piena altezza (evita la barra grigia sotto)
    const iframe = root.querySelector('iframe') as HTMLElement | null
    if (iframe) iframe.style.height = hidden ? '100vh' : ''
  })
  return touched > 0
}

// Attiva/disattiva il kiosk. Riprova (il pannello può non essere pronto) e, se
// attivo, ri-applica periodicamente in caso HA aggiunga nuovi shadow root.
export function setKiosk(hidden: boolean): void {
  let tries = 0
  const attempt = () => {
    const ok = applyOnce(hidden)
    tries += 1
    if (hidden && !ok && tries < 15) setTimeout(attempt, 400)
  }
  attempt()

  if (kioskTimer) { clearInterval(kioskTimer); kioskTimer = null }
  if (hidden) kioskTimer = setInterval(() => applyOnce(true), 2500)
}
