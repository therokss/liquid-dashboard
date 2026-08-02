import { useStore } from '../store'

// Kiosk: nasconde la barra/sidebar nativa di Home Assistant attorno all'ingress
// usando il protocollo UFFICIALE che HA espone per gli iframe degli add-on
// (postMessage 'home-assistant/subscribe-properties' / 'unsubscribe-properties',
// gestito da ha-panel-app.ts nel frontend di HA — il componente che renderizza i
// pannelli ingress persistenti come questo, dato che config.yaml imposta panel_icon
// e panel_title).
//
// In precedenza si iniettava CSS direttamente nel documento padre (l'ingress è
// same-origin, quindi raggiungibile) per forzare display:none su header/toolbar.
// Funzionava finché HA nascondeva il suo hamburger/sidebar-toggle (ha-menu-button)
// solo visivamente; da quando la sua visibilità è condizionata dallo stato reattivo
// hass.kioskMode (HA lo smonta/rimonta via Lit in base a quello stato, non solo via
// CSS), rimuovere il nostro <style> non basta più a farlo ricomparire — lo stato
// vero restava quello che HA gli aveva dato per conto suo, mai toccato dal nostro
// CSS. Aggiornando lo stato reale via postMessage invece di fingerlo con CSS,
// sidebar e hamburger si ripristinano correttamente qualunque cosa faccia HA.
export function kioskAvailable(): boolean {
  return window.parent !== window
}

export function setKiosk(hidden: boolean): void {
  if (window.parent === window) return
  if (hidden) {
    window.parent.postMessage({ type: 'home-assistant/subscribe-properties', kioskMode: true }, '*')
  } else {
    window.parent.postMessage({ type: 'home-assistant/unsubscribe-properties' }, '*')
  }
}

// Scorciatoia verso le impostazioni di Home Assistant.
//
// Il postMessage 'home-assistant/navigate' da solo non basta: lo ascolta
// ha-panel-app, cioè SOLO quando la dashboard è aperta dal pannello dell'add-on
// nella sidebar. Nella "plancia a schermo intero" la dashboard gira invece
// dentro una card iframe di una dashboard Lovelace (vedi /api/create-dashboard
// lato add-on) e nessuno ascolta quel messaggio: il pulsante non faceva nulla.
// Nell'app iOS/Android non siamo in un iframe e il messaggio non ha destinatario.
//
// Copriamo quindi tutti e tre i contesti:
//  1. pannello add-on → canale ufficiale (navigazione SPA, nessun ricaricamento);
//  2. card iframe → la stessa cosa che fa HA internamente in common/navigate.ts:
//     history.pushState + evento 'location-changed' sulla finestra di HA (che HA
//     ascolta in layouts/home-assistant.ts). L'iframe è same-origin — la sandbox
//     della card include allow-same-origin ma NON allow-top-navigation, quindi
//     cambiare location non sarebbe permesso;
//  3. app/browser standalone → apriamo l'URL di Home Assistant in una scheda.
const HA_SETTINGS_PATH = '/config'

// Ritardo prima del fallback: se il canale ufficiale ha un destinatario, HA ha già
// navigato (navigate() aspetta al massimo la chiusura di eventuali dialog).
const NAV_FALLBACK_MS = 250

// Finestra del frontend di Home Assistant che ci contiene, se raggiungibile
// (same-origin). null quando non siamo in un iframe o siamo cross-origin.
function haWindow(): (Window & typeof globalThis) | null {
  if (window.parent === window) return null
  try {
    const w = window.parent as Window & typeof globalThis
    void w.location.pathname // lancia se cross-origin
    return w
  } catch {
    return null
  }
}

function standaloneHaUrl(): string {
  const s = useStore.getState()
  return (s.activeHassUrl || s.hassUrl || s.hassUrlExternal || '').trim()
}

export function openHomeAssistantSettings(): void {
  navigateHomeAssistant(HA_SETTINGS_PATH)
}

export function navigateHomeAssistant(path: string): void {
  if (window.parent !== window) {
    window.parent.postMessage({ type: 'home-assistant/navigate', path }, '*')
  }

  const ha = haWindow()
  if (ha) {
    setTimeout(() => {
      try {
        const current = ha.location.pathname
        if (current === path || current.startsWith(path + '/')) return // ha già navigato HA
        ha.history.pushState(null, '', path)
        ha.dispatchEvent(new ha.CustomEvent('location-changed', { detail: { replace: false } }))
      } catch {
        /* il padre è diventato irraggiungibile: niente da fare */
      }
    }, NAV_FALLBACK_MS)
    return
  }

  // App iOS/Android o browser sulla porta 8098: non c'è nessun frontend HA
  // attorno a noi, apriamo quello configurato in una scheda esterna.
  const base = standaloneHaUrl()
  if (base) window.open(base.replace(/\/+$/, '') + path, '_blank', 'noopener')
}
