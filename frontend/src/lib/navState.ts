import { useCallback, useRef, useSyncExternalStore } from 'react'
import type { Tab } from '../components/nav/TabBar'

// Navigazione della dashboard: schermata aperta, ripristino al rientro e tasto
// Indietro (Android / browser).
//
// RICORDO PER DISPOSITIVO: la schermata (scheda, stanza per area_id, sottopagina)
// e lo scroll finiscono in una chiave localStorage dedicata, volutamente FUORI
// dallo store zustand persistito e dalle chiavi sincronizzate col server
// (userConfig/permissions/liveSync): il tablet in cucina e il telefono non devono
// rubarsi la schermata a vicenda. I popup (dettaglio luce, telecomando, QR,
// conferme) non passano di qui e quindi non vengono mai riaperti.
//
// TASTO INDIETRO: History API dentro il nostro documento (iframe dell'ingress,
// card della plancia, app companion, browser). Nell'ingress la cronologia è
// condivisa con la finestra di HA: aggiungiamo al massimo la gerarchia
// Casa → scheda → stanza/sottopagina (livelli 0-1-2), senza mai toccare la
// finestra di HA (lib/kiosk.ts naviga quella, non la nostra) e senza URL diversi
// (pushState con URL invariato: un ricaricamento riapre comunque la stessa pagina).
// Dalla radice (Casa senza nulla aperto) non c'è nessuna voce nostra: il tasto
// Indietro fa quello che faceva prima (esce / torna a HA).

export type SubPage = 'climate' | 'server' | 'updates' | 'dashboards'

export interface NavState {
  tab: Tab
  area?: string // area_id della stanza aperta (MAI il nome)
  sub?: SubPage
}

const STORAGE_KEY = 'liquid-dashboard-nav'
const TABS: readonly Tab[] = ['home', 'rooms', 'security', 'media', 'settings']
// Sottopagina → scheda madre
const SUB_TAB: Record<SubPage, Tab> = { climate: 'home', server: 'settings', updates: 'settings', dashboards: 'settings' }
const ROOT: NavState = { tab: 'home' }

// Dati non affidabili (localStorage/history.state): si tiene solo ciò che è coerente.
function sanitize(raw: unknown): NavState {
  if (!raw || typeof raw !== 'object') return ROOT
  const r = raw as Record<string, unknown>
  const tab = TABS.includes(r.tab as Tab) ? (r.tab as Tab) : 'home'
  const out: NavState = { tab }
  if (tab === 'rooms' && typeof r.area === 'string' && r.area) out.area = r.area
  else if (typeof r.sub === 'string' && SUB_TAB[r.sub as SubPage] === tab) out.sub = r.sub as SubPage
  return out
}

function level(n: NavState): number {
  return (n.tab !== 'home' ? 1 : 0) + (n.area || n.sub ? 1 : 0)
}

function sameNav(a: NavState, b: NavState): boolean {
  return a.tab === b.tab && a.area === b.area && a.sub === b.sub
}

// Chiavi di scroll della schermata attiva e di quella sotto (es. lista stanze
// nascosta sotto la stanza aperta): le altre si scartano.
function chainKeys(n: NavState): string[] {
  const keys: string[] = [n.tab]
  if (n.area) keys.push('room')
  if (n.sub) keys.push(n.sub)
  return keys
}

// ─── Persistenza (sempre in try/catch: storage bloccato o corrotto) ─────────

let scroll: Record<string, number> = {}

function readStored(): { nav: NavState; scroll: Record<string, number> } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { nav: ROOT, scroll: {} }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const nav = sanitize(parsed)
    const sc: Record<string, number> = {}
    const src = parsed.scroll
    if (src && typeof src === 'object') {
      for (const k of chainKeys(nav)) {
        const v = (src as Record<string, unknown>)[k]
        if (typeof v === 'number' && isFinite(v) && v > 0) sc[k] = Math.round(v)
      }
    }
    return { nav, scroll: sc }
  } catch {
    return { nav: ROOT, scroll: {} }
  }
}

function historyNav(): { nav: NavState; depth: number } | null {
  try {
    const st = history.state as Record<string, unknown> | null
    if (st && typeof st === 'object' && st.ldNav) {
      const d = Number(st.ldDepth)
      return { nav: sanitize(st.ldNav), depth: Number.isInteger(d) && d >= 0 && d <= 2 ? d : 0 }
    }
  } catch { /* ignora */ }
  return null
}

const stored = readStored()
// Su un ricaricamento il browser conserva history.state della voce corrente:
// ha la precedenza (è coerente con le voci di cronologia che restano sotto).
const fromHistory = historyNav()
let nav: NavState = fromHistory?.nav ?? stored.nav
let depth = fromHistory?.depth ?? 0 // quante voci NOSTRE ci sono sotto quella corrente
scroll = sameNav(nav, stored.nav) ? { ...stored.scroll } : {}
// Scroll da ripristinare una sola volta, quando il contenitore compare
const pendingRestore: Record<string, number> = { ...scroll }

let saveTimer: ReturnType<typeof setTimeout> | null = null

function writeNow(): void {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...nav, scroll }))
  } catch { /* storage pieno o bloccato: pazienza, niente ripristino */ }
}

function scheduleSave(): void {
  if (saveTimer) return
  saveTimer = setTimeout(writeNow, 200)
}

// ─── Store minimale (useSyncExternalStore) ──────────────────────────────────

const listeners = new Set<() => void>()

function setNav(next: NavState): void {
  if (sameNav(next, nav)) return
  nav = next
  const keep = chainKeys(next)
  for (const k of Object.keys(scroll)) if (!keep.includes(k)) delete scroll[k]
  for (const k of Object.keys(pendingRestore)) if (!keep.includes(k)) delete pendingRestore[k]
  writeNow()
  listeners.forEach((l) => l())
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

export function useNav(): NavState {
  return useSyncExternalStore(subscribe, () => nav)
}

// ─── Cronologia ─────────────────────────────────────────────────────────────

function entry(n: NavState, d: number): Record<string, unknown> {
  let base: Record<string, unknown> = {}
  try {
    const st = history.state
    if (st && typeof st === 'object') base = { ...(st as Record<string, unknown>) }
  } catch { /* ignora */ }
  return { ...base, ldNav: n, ldDepth: d }
}

// Destinazione in attesa mentre history.go(-k) è in corso (popstate è asincrono)
let pendingTarget: NavState | null = null
let started = false

function safe(fn: () => void): void {
  try { fn() } catch { /* History API non disponibile (sandbox): si naviga solo in-app */ }
}

function onPopState(e: PopStateEvent): void {
  const st = e.state as Record<string, unknown> | null
  if (!st || typeof st !== 'object' || !st.ldNav) return // voce non nostra
  const landed = sanitize(st.ldNav)
  const d = Number(st.ldDepth)
  depth = Number.isInteger(d) && d >= 0 ? d : 0
  if (pendingTarget) {
    // Ritorno avviato da noi (tasto indietro in-app o cambio scheda verso un
    // livello più basso): la voce raggiunta diventa la destinazione voluta.
    const target = pendingTarget
    pendingTarget = null
    if (level(target) > level(landed)) {
      depth += 1
      safe(() => history.pushState(entry(target, depth), ''))
    } else if (!sameNav(target, landed)) {
      safe(() => history.replaceState(entry(target, depth), ''))
    }
    setNav(target)
    return
  }
  setNav(landed)
}

// Da chiamare una volta quando la dashboard predefinita è a schermo.
export function startNavHistory(): void {
  if (started) return
  started = true
  // Marca la voce corrente come nostra (senza aggiungerne): nessuna cronologia finta.
  safe(() => history.replaceState(entry(nav, depth), ''))
  window.addEventListener('popstate', onPopState)
  const flush = () => writeNow()
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush() })
}

export function navigate(input: NavState): void {
  const next = sanitize(input)
  if (pendingTarget) {
    // Un history.go() è ancora in volo: aggiorniamo solo la destinazione.
    pendingTarget = next
    setNav(next)
    return
  }
  if (sameNav(next, nav)) return
  if (!started) { setNav(next); return }
  const from = level(nav)
  const to = level(next)
  if (to > from) {
    depth += 1
    safe(() => history.pushState(entry(next, depth), ''))
  } else if (to < from && depth > 0) {
    // Consuma le nostre voci invece di accumularne: niente cronologia infinita,
    // e il tasto Indietro successivo va davvero alla schermata di sotto.
    pendingTarget = next
    let went = false
    safe(() => { history.go(-Math.min(from - to, depth)); went = true })
    if (!went) { pendingTarget = null; safe(() => history.replaceState(entry(next, depth), '')) }
    else {
      // Rete di sicurezza: se il popstate non arriva, non restiamo bloccati.
      setTimeout(() => {
        if (!pendingTarget) return
        const target = pendingTarget
        pendingTarget = null
        safe(() => history.replaceState(entry(target, depth), ''))
      }, 1000)
    }
  } else {
    safe(() => history.replaceState(entry(next, depth), ''))
  }
  setNav(next)
}

// Scorciatoie per le pagine
export function openTab(tab: Tab): void {
  if (tab === nav.tab) return // come prima: toccare la scheda attiva non chiude nulla
  navigate({ tab })
}
export function openArea(areaId: string): void { navigate({ tab: 'rooms', area: areaId }) }
export function openSub(sub: SubPage): void { navigate({ tab: SUB_TAB[sub], sub }) }
// Pulsante "indietro" in-app di stanza/sottopagina: torna alla pagina madre
// consumando la voce di cronologia, così il tasto Indietro resta coerente.
export function closeChild(): void {
  if (!nav.area && !nav.sub) return
  navigate({ tab: nav.tab })
}

// ─── Scroll ─────────────────────────────────────────────────────────────────

const RESTORE_TIMEOUT_MS = 3000

function attachScroll(el: HTMLElement, key: string): () => void {
  let raf = 0
  let restoring = false
  const stopRestore = () => {
    if (!restoring) return
    restoring = false
    cancelAnimationFrame(raf)
    delete pendingRestore[key]
  }
  const target = pendingRestore[key]
  if (target) {
    // Il contenuto può crescere dopo il montaggio (entità, griglie, immagini):
    // riproviamo a ogni frame finché lo scroll arriva al punto salvato.
    restoring = true
    const t0 = performance.now()
    const step = () => {
      if (!restoring) return
      el.scrollTop = target
      if (Math.abs(el.scrollTop - target) <= 1 || performance.now() - t0 > RESTORE_TIMEOUT_MS) {
        stopRestore()
        scroll[key] = el.scrollTop
        scheduleSave()
        return
      }
      raf = requestAnimationFrame(step)
    }
    step()
  }
  const onScroll = () => {
    if (restoring) return // scroll programmatico del ripristino
    scroll[key] = Math.max(0, Math.round(el.scrollTop))
    scheduleSave()
  }
  // Se l'utente tocca/scorre durante il ripristino, vince lui.
  const onUser = () => stopRestore()
  const userEvents = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
  el.addEventListener('scroll', onScroll, { passive: true })
  userEvents.forEach((ev) => el.addEventListener(ev, onUser, { passive: true }))
  return () => {
    restoring = false
    cancelAnimationFrame(raf)
    el.removeEventListener('scroll', onScroll)
    userEvents.forEach((ev) => el.removeEventListener(ev, onUser))
  }
}

// Ref da mettere sul contenitore che scorre di una schermata.
// key: scheda ('home', 'rooms'…), 'room' per la stanza aperta, o la sottopagina.
export function useScrollMemory<T extends HTMLElement = HTMLElement>(key: string): (el: T | null) => void {
  const cleanup = useRef<(() => void) | null>(null)
  return useCallback((el: T | null) => {
    cleanup.current?.()
    cleanup.current = el ? attachScroll(el, key) : null
  }, [key])
}
