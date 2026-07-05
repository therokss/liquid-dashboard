import { useEffect, useCallback } from 'react'
import {
  createLongLivedTokenAuth,
  createConnection,
  subscribeEntities,
  ERR_INVALID_AUTH,
  ERR_HASS_HOST_REQUIRED,
} from 'home-assistant-js-websocket'
import type { Connection, Auth, ConnectionOptions } from 'home-assistant-js-websocket'
import type { HassArea } from '../types/ha'
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
    connection.sendMessagePromise<Array<{ id: string; area_id: string | null }>>(
      { type: 'config/device_registry/list' }
    ),
  ])

  const deviceArea: Record<string, string> = {}
  for (const d of devReg) if (d.area_id) deviceArea[d.id] = d.area_id

  const areaMap: Record<string, string> = {}
  const devices: Record<string, string> = {}
  const hidden: Record<string, true> = {}
  for (const e of entReg) {
    const area = e.area_id ?? (e.device_id ? deviceArea[e.device_id] : undefined)
    if (area) areaMap[e.entity_id] = area
    if (e.device_id) devices[e.entity_id] = e.device_id
    // Auto-nascoste: nascoste/disabilitate in HA, entità di configurazione/diagnostica,
    // oppure l'integrazione Plex (nascosta di default: crea un media_player per ogni client)
    if (e.hidden_by || e.disabled_by || e.entity_category === 'config' || e.entity_category === 'diagnostic' || e.platform === 'plex') {
      hidden[e.entity_id] = true
    }
  }
  return { areaMap, devices, hidden }
}

interface ConnOpts {
  auth: Auth
  createSocket?: (opts: ConnectionOptions) => Promise<WebSocket>
}

async function buildConnectionOptions(): Promise<ConnOpts> {
  // Modalità proxy: il server autentica con SUPERVISOR_TOKEN.
  // Usiamo l'handshake standard della libreria: si connette a <base>/api/websocket
  // (intercettato dal proxy). Il browser invia `auth` con un token dummy che il
  // proxy sostituisce con il SUPERVISOR_TOKEN reale prima di inoltrarlo a HA.
  if (localStorage.getItem('ha-ll-use-proxy') === '1') {
    const { origin, pathname } = window.location
    const base = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname.replace(/\/[^/]*$/, '')
    return {
      auth: createLongLivedTokenAuth(origin + base, 'supervisor-proxy'),
    }
  }

  // Modalità long-lived token
  let hassUrl = useStore.getState().hassUrl || 'http://homeassistant.local:8123'

  // Migrazione: se l'URL era window.location.origin (vecchio codice) o Nabu Casa
  if (hassUrl === window.location.origin || hassUrl.includes('nabu.casa')) {
    hassUrl = 'http://homeassistant.local:8123'
    useStore.getState().setHassUrl(hassUrl)
  }

  const storedToken = localStorage.getItem('ha-ll-token')
  if (!storedToken) {
    throw Object.assign(new Error('NO_TOKEN'), { isNoToken: true })
  }

  return { auth: createLongLivedTokenAuth(hassUrl, storedToken) }
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
    const opts = await buildConnectionOptions()
    const connection = await Promise.race([
      createConnection(opts as ConnectionOptions),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('LD_TIMEOUT')), 15000)
      ),
    ])

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
