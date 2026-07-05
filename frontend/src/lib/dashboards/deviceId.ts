// ID stabile di QUESTO schermo (dispositivo/browser). Serve ad assegnare una dashboard
// custom a un tablet a muro specifico. Generato una volta e salvato in localStorage,
// quindi è per-dispositivo (non segue l'utente su altri schermi).
const DEVICE_ID_KEY = 'ld-screen-id'
const DEVICE_NAME_KEY = 'ld-screen-name'

export function getScreenId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY)
  if (!id) {
    id = 's' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
    localStorage.setItem(DEVICE_ID_KEY, id)
  }
  return id
}

// Nome leggibile dello schermo (modificabile dall'utente, es. "Tablet ingresso").
export function getScreenName(): string {
  return localStorage.getItem(DEVICE_NAME_KEY) || defaultScreenName()
}

export function setScreenName(name: string): void {
  localStorage.setItem(DEVICE_NAME_KEY, name)
}

function defaultScreenName(): string {
  const ua = navigator.userAgent
  if (/iPad/.test(ua)) return 'iPad'
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/Android/.test(ua)) return 'Android'
  if (/Macintosh/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'PC'
  return 'Questo schermo'
}
