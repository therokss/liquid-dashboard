// Navigazione verso una pagina di Home Assistant dal pannello dell'add-on (iframe ingress).
// Come in Liquid Dashboard (frontend/src/lib/kiosk.ts): il canale ufficiale è il postMessage
// 'home-assistant/navigate' ascoltato da ha-panel-app; se nessuno risponde, l'iframe è
// same-origin e si naviga come fa HA (pushState + 'location-changed') sulla finestra più
// esterna con la stessa origine, che è il frontend di HA. Di solito coincide con parent, ma
// quando l'Assistente è aperto dal pulsante di Liquid Dashboard parent è la dashboard, non HA.

function outermostSameOrigin(): Window & typeof globalThis {
  let w: Window = window.parent
  try {
    while (w.parent !== w) {
      void w.parent.location.pathname // lancia se cross-origin
      w = w.parent
    }
  } catch {
    // oltre c'è un'altra origine: ci si ferma qui
  }
  return w as Window & typeof globalThis
}

export function navigateHomeAssistant(path: string): void {
  if (window.parent === window) {
    window.open(path, '_blank', 'noopener')
    return
  }
  window.parent.postMessage({ type: 'home-assistant/navigate', path }, '*')
  setTimeout(() => {
    try {
      const ha = outermostSameOrigin()
      if (ha.location.pathname === path) return
      ha.history.pushState(null, '', path)
      ha.dispatchEvent(new ha.CustomEvent('location-changed', { detail: { replace: false } }))
    } catch {
      // cross-origin: niente da fare
    }
  }, 250)
}

export const automationEditorPath = (automationId: string) => `/config/automation/edit/${encodeURIComponent(automationId)}`
