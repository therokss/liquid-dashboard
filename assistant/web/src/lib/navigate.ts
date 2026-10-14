// Navigazione verso una pagina di Home Assistant dal pannello dell'add-on (iframe ingress).
// Come in Liquid Dashboard (frontend/src/lib/kiosk.ts): il canale ufficiale è il postMessage
// 'home-assistant/navigate' ascoltato da ha-panel-app; se nessuno risponde, l'iframe è
// same-origin e si naviga come fa HA (pushState + 'location-changed').

export function navigateHomeAssistant(path: string): void {
  if (window.parent === window) {
    window.open(path, '_blank', 'noopener')
    return
  }
  window.parent.postMessage({ type: 'home-assistant/navigate', path }, '*')
  setTimeout(() => {
    try {
      const ha = window.parent as Window & typeof globalThis
      if (ha.location.pathname === path) return
      ha.history.pushState(null, '', path)
      ha.dispatchEvent(new ha.CustomEvent('location-changed', { detail: { replace: false } }))
    } catch {
      // cross-origin: niente da fare
    }
  }, 250)
}

export const automationEditorPath = (automationId: string) => `/config/automation/edit/${encodeURIComponent(automationId)}`
