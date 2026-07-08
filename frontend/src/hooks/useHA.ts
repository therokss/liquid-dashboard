import { useEffect, useCallback } from 'react'
import {
  createLongLivedTokenAuth,
  createConnection,
  subscribeEntities,
  ERR_INVALID_AUTH,
  ERR_HASS_HOST_REQUIRED,
} from 'home-assistant-js-websocket'
import type { Connection } from 'home-assistant-js-websocket'
import type { HassArea, DeviceInfo } from '../types/ha'
import { useStore } from '../store'

async function fetchAreas(connection: Connection): Promise<HassArea[]> {
  const result = await connection.sendMessagePromise({ type: 'config/area_registry/list' })
  return result as HassArea[]
}

// Gli oggetti-stato delle entità NON contengono l'area né lo stato "nascosto":
// vanno ricavati dai registri.
//  - area effettiva = area diretta dell'entità, altrimenti area del suo device
//  - nascosta = hidden_by o disabled_by valorizzati in HA
interface Registries {
  areaMap: Record<string, string>
  devices: Record<string, string>
  hidden: Record<string, true>
  system: Record<string, true>
  platform: Record<string, string> // entity_id → integrazione (webostv, apple_tv, cast, …)
  deviceInfo: Record<string, DeviceInfo> // device_id → produttore/modello/MAC
}

async function fetchRegistries(connection: Connection): Promise<Registries> {
  const [entReg, devReg] = await Promise.all([
    connection.sendMessagePromise<
      Array<{
        entity_id: string
        area_id: string | null
        device_id: string | null
        hidden_by: string | null
        disabled_by: string | null
        entity_category: string | null
        platform: string | null
      }>
    >({ type: 'config/entity_registry/list' }),
    connection.sendMessagePromise<
      Array<{
        id: string
        area_id: string | null
        manufacturer: string | null
        model: string | null
        connections: Array<[string, string]> | null
      }>
    >({ type: 'config/device_registry/list' }),
  ])

  const deviceArea: Record<string, string> = {}
  const deviceInfo: Record<string, DeviceInfo> = {}
  for (const d of devReg) {
    if (d.area_id) deviceArea[d.id] = d.area_id
    const mac = (d.connections ?? []).find((c) => c[0] === 'mac')?.[1]
    if (d.manufacturer || d.model || mac) {
      deviceInfo[d.id] = {
        manufacturer: d.manufacturer ?? undefined,
        model: d.model ?? undefined,
        mac: mac ? mac.toUpperCase() : undefined,
      }
    }
  }

  const areaMap: Record<string, string> = {}
  const devices: Record<string, string> = {}
  const hidden: Record<string, true> = {}
  const system: Record<string, true> = {} // config/diagnostic: button "di sistema", ecc.
  const platform: Record<string, string> = {} // entity_id → integrazione
  for (const e of entReg) {
    const area = e.area_id ?? (e.device_id ? deviceArea[e.device_id] : undefined)
    if (area) areaMap[e.entity_id] = area
    if (e.device_id) devices[e.entity_id] = e.device_id
    if (e.platform) platform[e.entity_id] = e.platform
    if (e.entity_category === 'config' || e.entity_category === 'diagnostic') system[e.entity_id] = true
    // Auto-nascoste: nascoste/disabilitate in HA, entità di configurazione/diagnostica,
    // oppure l'integrazione Plex (nascosta di default: crea un media_player per ogni client)
    if (e.hidden_by || e.disabled_by || e.entity_category === 'config' || e.entity_category === 'diagnostic' || e.platform === 'plex') {
      hidden[e.entity_id] = true
    }
  }
  return { areaMap, devices, hidden, system, platform, deviceInfo }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('LD_TIMEOUT')), ms)),
  ])
}

// URL candidati in ordine di preferenza: prima l'interno (LAN, veloce a casa),
// poi l'esterno (remoto/Nabu Casa, per quando si è fuori). Duplicati/vuoti rimossi.
function candidateUrls(): string[] {
  const s = useStore.getState()
  let internal = s.hassUrl || 'http://homeassistant.local:8123'
  // Migrazione: se per errore era salvato l'origin dell'app stessa (vecchio codice
  // ingress), ripulisci. Un URL Nabu Casa come esterno è invece valido (remoto).
  if (internal === window.location.origin) {
    internal = 'http://homeassistant.local:8123'
    s.setHassUrl(internal)
  }
  const external = (s.hassUrlExternal || '').trim()
  return Array.from(new Set([internal.trim(), external].filter(Boolean)))
}

// Stabilisce la connessione. In add-on: auth via proxy. In app: prova l'interno e,
// se non risponde entro pochi secondi, ripiega sull'esterno. Salva l'URL vincente
// (activeHassUrl) così la porta 8098 del backend condiviso punta all'indirizzo giusto.
async function establishConnection(): Promise<Connection> {
  const store = useStore.getState()

  // Modalità proxy: il server autentica con SUPERVISOR_TOKEN. Handshake standard verso
  // <base>/api/websocket (intercettato dal proxy); il browser invia un token dummy che
  // il proxy sostituisce col SUPERVISOR_TOKEN reale prima di inoltrarlo a HA.
  if (localStorage.getItem('ha-ll-use-proxy') === '1') {
    const { origin, pathname } = window.location
    const base = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname.replace(/\/[^/]*$/, '')
    store.setActiveHassUrl(null)
    const auth = createLongLivedTokenAuth(origin + base, 'supervisor-proxy')
    return await withTimeout(createConnection({ auth }), 15000)
  }

  // Modalità long-lived token (app standalone)
  const token = localStorage.getItem('ha-ll-token')
  if (!token) throw Object.assign(new Error('NO_TOKEN'), { isNoToken: true })

  const urls = candidateUrls()
  let lastErr: unknown = new Error('LD_NO_URL')
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]
    const isLast = i === urls.length - 1
    try {
      const auth = createLongLivedTokenAuth(url, token)
      // Timeout più corto sui candidati non finali: se l'interno non risponde
      // (sei fuori casa) si passa in fretta all'esterno senza attese lunghe.
      const conn = await withTimeout(createConnection({ auth }), isLast ? 12000 : 6000)
      store.setActiveHassUrl(url)
      return conn
    } catch (e) {
      lastErr = e
      if (e === ERR_INVALID_AUTH) throw e // token errato: inutile provare altri URL
    }
  }
  throw lastErr
}

// --- Connessione singleton (una sola per tutta l'app) --------------------
// useHA() viene chiamato da molti componenti (Dashboard, LightCard, MediaCard…).
// Se ognuno aprisse la propria connessione avremmo decine di socket e un loop
// di setLoading. La connessione è quindi un singleton a livello di modulo.
let sharedConnection: Connection | null = null
let connectStarted = false

async function ensureConnection(): Promise<void> {
  if (connectStarted) return
  connectStarted = true

  const store = useStore.getState()
  store.setLoading(true)

  try {
    const connection = await establishConnection()

    sharedConnection = connection

    connection.addEventListener('disconnected', () =>
      useStore.getState().setConnected(false)
    )
    connection.addEventListener('ready', () => {
      useStore.getState().setConnected(true)
      Promise.all([fetchAreas(connection), fetchRegistries(connection)])
        .then(([a, reg]) => {
          const st = useStore.getState()
          st.setAreas(a)
          st.setEntityAreas(reg.areaMap)
          st.setEntityDevices(reg.devices)
          st.setHiddenEntities(reg.hidden)
          st.setSystemEntities(reg.system)
          st.setEntityPlatform(reg.platform)
          st.setDeviceInfo(reg.deviceInfo)
        })
        .catch(() => {})
    })

    const s = useStore.getState()
    s.setConnected(true)
    s.setLoading(false)
    s.completeSetup()

    subscribeEntities(connection, (entities) => {
      useStore.getState().setEntities(entities)
    })

    try {
      const [areas, reg] = await Promise.all([
        fetchAreas(connection),
        fetchRegistries(connection),
      ])
      const st = useStore.getState()
      st.setAreas(areas)
      st.setEntityAreas(reg.areaMap)
      st.setEntityDevices(reg.devices)
      st.setHiddenEntities(reg.hidden)
      st.setSystemEntities(reg.system)
      st.setEntityPlatform(reg.platform)
      st.setDeviceInfo(reg.deviceInfo)
    } catch {
      console.warn('[LD] fetch registri fallito, riproverò al reconnect')
    }
  } catch (err) {
    connectStarted = false // consenti un nuovo tentativo
    const s = useStore.getState()
    s.setLoading(false)
    s.setConnected(false)

    const isNoToken = (err as Error)?.message === 'NO_TOKEN'
    if (err === ERR_INVALID_AUTH || isNoToken) {
      localStorage.removeItem('ha-ll-token')
      localStorage.removeItem('ha-ll-oauth')
      localStorage.removeItem('ha-ll-use-proxy')
      useStore.getState().resetSetup()
      window.location.reload()
    } else if (err === ERR_HASS_HOST_REQUIRED) {
      console.warn('[LD] Host HA non trovato, serve configurazione manuale')
    } else {
      console.error('[LD] Errore connessione:', err)
    }
  }
}

function reconnect() {
  if (sharedConnection) {
    try { sharedConnection.close() } catch { /* noop */ }
    sharedConnection = null
  }
  connectStarted = false
  ensureConnection()
}

// Optimistic UI: per i comandi on/off/toggle su entità con stato on/off, mostra subito
// il nuovo stato nell'interfaccia. Lo store rimuove l'override quando arriva la conferma
// reale o fa il rollback se il dispositivo non risponde entro il TTL.
function applyOptimisticForCall(service: string, data: Record<string, unknown>): void {
  if (service !== 'turn_on' && service !== 'turn_off' && service !== 'toggle') return
  const raw = (data || {}).entity_id
  const ids = Array.isArray(raw)
    ? raw.filter((x): x is string => typeof x === 'string')
    : typeof raw === 'string' ? [raw] : []
  if (ids.length === 0) return
  const st = useStore.getState()
  for (const id of ids) {
    const cur = st.realEntities[id]
    if (!cur || (cur.state !== 'on' && cur.state !== 'off')) continue // solo entità on/off
    const target = service === 'turn_on' ? 'on' : service === 'turn_off' ? 'off' : cur.state === 'on' ? 'off' : 'on'
    const patch: { state: string; attributes?: Record<string, unknown> } = { state: target }
    if (target === 'on') {
      const attrs: Record<string, unknown> = {}
      if (typeof data.brightness_pct === 'number') attrs.brightness = Math.round((data.brightness_pct as number) * 2.55)
      else if (typeof data.brightness === 'number') attrs.brightness = data.brightness as number
      if (Object.keys(attrs).length) patch.attributes = attrs
    }
    st.applyOptimistic(id, patch)
  }
}

export function useHA() {
  // Ogni componente che usa useHA garantisce che la connessione esista, ma
  // ensureConnection() è idempotente: apre un solo socket condiviso.
  // Non chiudiamo la connessione allo smontaggio: è condivisa.
  useEffect(() => {
    ensureConnection()
  }, [])

  const callService = useCallback(
    async (domain: string, service: string, serviceData: Record<string, unknown>) => {
      if (!sharedConnection) return
      applyOptimisticForCall(service, serviceData) // aggiorna subito l'UI (rollback se non conferma)
      await sharedConnection.sendMessagePromise({
        type: 'call_service',
        domain,
        service,
        service_data: serviceData,
      })
    },
    []
  )

  // Invia un comando WebSocket generico (es. energy/get_prefs, recorder/statistics_during_period)
  const sendMessage = useCallback(
    async <T = unknown>(message: { type: string } & Record<string, unknown>): Promise<T | null> => {
      if (!sharedConnection) return null
      return await sharedConnection.sendMessagePromise<T>(message)
    },
    []
  )

  // Sottoscrive un comando WS che emette più eventi (es. camera/webrtc/offer).
  // Ritorna la funzione di unsubscribe. Se il tipo è sconosciuto, rilancia (per il fallback).
  const subscribe = useCallback(
    async <T = unknown>(
      message: { type: string } & Record<string, unknown>,
      onEvent: (ev: T) => void,
    ): Promise<() => void> => {
      if (!sharedConnection) return () => {}
      return await sharedConnection.subscribeMessage<T>(onEvent, message)
    },
    []
  )

  // Chiama un servizio che restituisce dati (return_response), es. weather.get_forecasts
  const callServiceResponse = useCallback(
    async <T = unknown>(
      domain: string,
      service: string,
      serviceData: Record<string, unknown>
    ): Promise<T | null> => {
      if (!sharedConnection) return null
      const res = await sharedConnection.sendMessagePromise<{ response: T }>({
        type: 'call_service',
        domain,
        service,
        service_data: serviceData,
        return_response: true,
      })
      return res?.response ?? null
    },
    []
  )

  const getHistoryForEntity = useCallback(
    async (entityId: string, hours = 24): Promise<Array<{ state: string; last_changed: string }>> => {
      if (!sharedConnection) return []
      const end = new Date()
      const start = new Date(end.getTime() - hours * 60 * 60 * 1000)

      const result = await sharedConnection.sendMessagePromise({
        type: 'history/history_during_period',
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        significant_changes_only: true,
        minimal_response: true,
        entity_ids: [entityId],
      })

      return (result as Record<string, Array<{ s: string; lu: number }>>)[entityId]
        ?.map((item) => ({
          state: item.s,
          last_changed: new Date(item.lu * 1000).toISOString(),
        })) ?? []
    },
    []
  )

  // Storico con attributi (formato compresso HA: attributi solo quando cambiano → carry-forward)
  const getEntityHistory = useCallback(
    async (entityId: string, hours = 24): Promise<Array<{ state: string; attributes: Record<string, unknown> }>> => {
      if (!sharedConnection) return []
      const end = new Date()
      const start = new Date(end.getTime() - hours * 60 * 60 * 1000)
      const result = await sharedConnection.sendMessagePromise<Record<string, Array<Record<string, unknown>>>>({
        type: 'history/history_during_period',
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        significant_changes_only: false,
        minimal_response: false,
        entity_ids: [entityId],
      })
      const arr = result?.[entityId] ?? []
      let attrs: Record<string, unknown> = {}
      return arr.map((item) => {
        const a = (item.a ?? item.attributes) as Record<string, unknown> | undefined
        if (a) attrs = { ...attrs, ...a }
        return { state: String(item.s ?? item.state ?? ''), attributes: attrs }
      })
    },
    []
  )

  return { callService, callServiceResponse, sendMessage, subscribe, getHistoryForEntity, getEntityHistory, reconnect }
}

export function clearAuth() {
  localStorage.removeItem('ha-ll-oauth')
}
export function saveToken(token: string) {
  localStorage.setItem('ha-ll-token', token)
}
export function getToken(): string | null {
  return localStorage.getItem('ha-ll-token')
}
export function clearToken() {
  localStorage.removeItem('ha-ll-token')
}

// ─── Comandi WS diretti (usati in modalità app standalone, senza add-on) ───────

// Firma un percorso /api/… di HA: restituisce lo stesso path con ?authSig=<JWT>,
// caricabile in <img> senza header di autenticazione. expires in secondi.
export async function signPath(path: string, expires = 86400): Promise<string | null> {
  if (!sharedConnection || !path.startsWith('/')) return null
  try {
    const res = await sharedConnection.sendMessagePromise<{ path: string }>({ type: 'auth/sign_path', path, expires })
    return res?.path ?? null
  } catch { return null }
}

// Storage per-utente dentro Home Assistant: le stesse impostazioni seguono l'utente
// su tutti i client (app, dashboard ingress, frontend ufficiale).
export async function getUserData<T = unknown>(key: string): Promise<T | null> {
  if (!sharedConnection) return null
  try {
    const res = await sharedConnection.sendMessagePromise<{ value: T | null }>({ type: 'frontend/get_user_data', key })
    return res?.value ?? null
  } catch { return null }
}
export async function setUserData(key: string, value: unknown): Promise<boolean> {
  if (!sharedConnection) return false
  try {
    await sharedConnection.sendMessagePromise({ type: 'frontend/set_user_data', key, value })
    return true
  } catch { return false }
}

// Utente corrente (per sapere se è amministratore in modalità app).
export async function getCurrentUser(): Promise<{ id: string; name?: string; is_admin?: boolean } | null> {
  if (!sharedConnection) return null
  try {
    return await sharedConnection.sendMessagePromise({ type: 'auth/current_user' })
  } catch { return null }
}
