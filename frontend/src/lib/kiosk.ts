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

// Scorciatoia verso le impostazioni di Home Assistant: usa lo stesso canale
// postMessage ('home-assistant/navigate', gestito da ha-panel-app.ts) invece
// di affidarsi alla sola visibilità del pulsante hamburger — funziona anche
// se la sidebar nativa non è (ancora) tornata visibile.
export function openHomeAssistantSettings(): void {
  if (window.parent === window) return
  window.parent.postMessage({ type: 'home-assistant/navigate', path: '/config' }, '*')
}
