import type { HAReader } from '../src/ha/data.ts'
import { toAreaEntry, toDeviceEntry, toEntityEntry, toFloorEntry, type HAState, type Registries } from '../src/ha/types.ts'

// Casa finta per i test: SOLO dati sintetici (il repo è pubblico). Copre i casi delle regole
// R1–R6 e delle categorie di privacy.

type Json = Record<string, any>

const T0 = '2026-10-14T08:00:00+00:00'

function st(entity_id: string, state: string, attributes: Json = {}, changed = T0): HAState {
  return { entity_id, state, attributes, last_changed: changed, last_updated: changed }
}

function ent(entity_id: string, platform: string, extra: Json = {}): Json {
  return { entity_id, platform, device_id: null, area_id: null, disabled_by: null, hidden_by: null, entity_category: null, name: null, original_name: null, labels: [], categories: {}, ...extra }
}

function dev(id: string, extra: Json = {}): Json {
  return { id, name: null, name_by_user: null, manufacturer: null, model: null, model_id: null, area_id: null, disabled_by: null, entry_type: null, primary_config_entry: null, config_entries: [], via_device_id: null, sw_version: null, labels: [], serial_number: 'SN-DA-NON-INVIARE', connections: [['mac', 'aa:bb:cc:dd:ee:ff']], ...extra }
}

export function fakeRegistries(): Registries {
  const floors = [toFloorEntry({ floor_id: 'primo', name: 'Primo piano', level: 1 }), toFloorEntry({ floor_id: 'terra', name: 'Piano terra', level: 0 })]
  const areas = [
    toAreaEntry({ area_id: 'soggiorno', name: 'Soggiorno', floor_id: 'terra', aliases: ['salotto'] }),
    toAreaEntry({ area_id: 'cucina', name: 'Cucina', floor_id: 'terra', aliases: [] }),
    toAreaEntry({ area_id: 'camera', name: 'Camera', floor_id: 'primo', aliases: [] }),
    toAreaEntry({ area_id: 'ingresso', name: 'Ingresso', floor_id: 'terra', aliases: [] }),
  ]
  const devices = [
    dev('dev_lampada', { name: 'Lampada Arco', manufacturer: 'Lumi', model: 'L100', area_id: 'soggiorno', primary_config_entry: 'ce_lumi', sw_version: '1.2.3' }),
    dev('dev_presenza', { name: 'Radar soggiorno', manufacturer: 'Sensa', model: 'P2', area_id: 'soggiorno' }),
    dev('dev_presa', { name: 'Presa lavatrice', manufacturer: 'Relè', model: 'Plug S', area_id: 'cucina' }),
    dev('dev_rele', { name: 'Relè camera', manufacturer: 'Relè', model: '2PM', area_id: 'camera' }),
    dev('dev_rete', { name: 'Switch rete', manufacturer: 'Rete', model: 'US-8' }),
    dev('dev_telefono', { name: 'Telefono di Demo', manufacturer: 'Fono', model: 'X1' }),
    dev('dev_cam', { name: 'Videocamera ingresso', manufacturer: 'Cam', model: 'C1', area_id: 'ingresso' }),
  ]
  const entities = [
    ent('light.lampada_arco', 'lumi', { device_id: 'dev_lampada' }),
    ent('binary_sensor.radar_presenza', 'sensa', { device_id: 'dev_presenza' }),
    ent('sensor.radar_illuminamento', 'sensa', { device_id: 'dev_presenza' }),
    ent('sensor.radar_rssi', 'sensa', { device_id: 'dev_presenza', entity_category: 'diagnostic' }),
    ent('switch.presa_lavatrice', 'rele', { device_id: 'dev_presa' }),
    ent('sensor.presa_lavatrice_potenza', 'rele', { device_id: 'dev_presa' }),
    ent('sensor.presa_lavatrice_tensione', 'rele', { device_id: 'dev_presa' }),
    ent('light.rele_camera', 'rele', { device_id: 'dev_rele' }),
    ent('switch.rele_camera_uscita', 'rele', { device_id: 'dev_rele' }),
    ent('switch.switch_rete_porta_1', 'unifi', { device_id: 'dev_rete' }),
    ent('sensor.telefono_batteria', 'mobile_app', { device_id: 'dev_telefono' }),
    ent('sensor.telefono_posizione', 'mobile_app', { device_id: 'dev_telefono' }),
    ent('device_tracker.telefono', 'mobile_app', { device_id: 'dev_telefono' }),
    ent('camera.ingresso', 'cam', { device_id: 'dev_cam' }),
    ent('binary_sensor.ingresso_movimento', 'cam', { device_id: 'dev_cam' }),
    ent('person.demo', 'person'),
    ent('button.riavvia_router', 'rete'),
    ent('update.lampada_arco_firmware', 'lumi', { device_id: 'dev_lampada' }),
    ent('light.vecchia', 'lumi', { disabled_by: 'user' }),
    ent('light.nascosta', 'lumi', { hidden_by: 'user' }),
    ent('automation.luci_sera', 'automation', { categories: { automation: 'cat_luci' } }),
    ent('automation.vecchia', 'automation'),
  ].map(toEntityEntry)
  return {
    entities,
    devices: devices.map(toDeviceEntry),
    areas,
    floors,
    labels: [{ label_id: 'test', name: 'Test' }],
    automationCategories: [{ category_id: 'cat_luci', name: 'Luci' }],
    configEntryDomain: { ce_lumi: 'lumi' },
    loadedAt: 0,
  }
}

export function fakeStates(): Map<string, HAState> {
  const list = [
    st('light.lampada_arco', 'on', { friendly_name: 'Lampada arco', brightness: 200, entity_picture: '/api/image?token=abc' }),
    st('binary_sensor.radar_presenza', 'off', { friendly_name: 'Radar presenza', device_class: 'occupancy' }),
    st('sensor.radar_illuminamento', '120', { friendly_name: 'Radar illuminamento', device_class: 'illuminance', unit_of_measurement: 'lx' }),
    st('sensor.radar_rssi', '-60', { friendly_name: 'Radar RSSI', device_class: 'signal_strength' }),
    st('switch.presa_lavatrice', 'on', { friendly_name: 'Presa lavatrice' }),
    st('sensor.presa_lavatrice_potenza', '1.5', { friendly_name: 'Potenza lavatrice', device_class: 'power', unit_of_measurement: 'W' }),
    st('sensor.presa_lavatrice_tensione', '230', { friendly_name: 'Tensione lavatrice', device_class: 'voltage', unit_of_measurement: 'V' }),
    st('light.rele_camera', 'off', { friendly_name: 'Luce camera' }),
    st('switch.rele_camera_uscita', 'off', { friendly_name: 'Uscita relè camera' }),
    st('switch.switch_rete_porta_1', 'on', { friendly_name: 'Porta 1 PoE' }),
    st('sensor.telefono_batteria', '80', { friendly_name: 'Batteria telefono', device_class: 'battery' }),
    st('sensor.telefono_posizione', 'Via Finta 1', { friendly_name: 'Posizione telefono' }),
    st('device_tracker.telefono', 'home', { latitude: 45.1, longitude: 9.1, gps_accuracy: 10 }),
    st('camera.ingresso', 'idle', { friendly_name: 'Ingresso', access_token: 'segreto-camera', entity_picture: '/api/camera_proxy/camera.ingresso?token=x' }),
    st('binary_sensor.ingresso_movimento', 'off', { friendly_name: 'Movimento ingresso', device_class: 'motion' }),
    st('person.demo', 'Ufficio', { friendly_name: 'Demo', latitude: 45.2, longitude: 9.2, gps_accuracy: 5, source: 'device_tracker.telefono', user_id: 'u1' }),
    st('zone.home', 'zoning', { friendly_name: 'Casa', latitude: 45.0, longitude: 9.0, radius: 100 }),
    st('button.riavvia_router', 'unknown', { friendly_name: 'Riavvia router' }),
    st('update.lampada_arco_firmware', 'off', { friendly_name: 'Firmware lampada' }),
    st('light.nascosta', 'off', { friendly_name: 'Nascosta' }),
    st('input_boolean.ospiti', 'off', { friendly_name: 'Ospiti' }),
    st('sensor.media_temperatura', '21.5', { friendly_name: 'Temperatura media', device_class: 'temperature', unit_of_measurement: '°C' }),
    st('sensor.router_ip', '192.168.1.1', { friendly_name: 'IP router', mac: 'aa:bb:cc:dd:ee:01' }),
    st('automation.luci_sera', 'on', { friendly_name: 'Luci sera', id: '1700000000001', last_triggered: '2026-10-13T17:30:00+00:00', mode: 'single', current: 0 }),
    st('automation.vecchia', 'off', { friendly_name: 'Vecchia', id: '1700000000002', last_triggered: null, mode: 'single', current: 0 }),
    st('sun.sun', 'above_horizon', { friendly_name: 'Sole', next_rising: '2026-10-15T05:30:00+00:00' }),
  ]
  return new Map(list.map((s) => [s.entity_id, s]))
}

export const AUTOMATION_CONFIG: Json = {
  id: '1700000000001',
  alias: 'Luci sera',
  description: 'Accende la lampada al tramonto se c’è qualcuno',
  triggers: [{ trigger: 'sun', event: 'sunset' }, { trigger: 'webhook', webhook_id: 'segretissimo-webhook', allowed_methods: ['POST'] }],
  conditions: [{ condition: 'state', entity_id: 'binary_sensor.radar_presenza', state: 'on' }],
  actions: [
    { action: 'light.turn_on', target: { entity_id: 'light.lampada_arco' } },
    { action: 'notify.mobile_app', data: { message: "Tensione {{ states('sensor.presa_lavatrice_tensione') }} V", url: 'https://example.invalid/hook?token=abc' } },
  ],
  mode: 'single',
}

const TRIGGER_CATALOG: Json = {
  state: { fields: { entity_id: { required: true, selector: { entity: {} } } } },
  numeric_state: { fields: {} },
  sun: { fields: {} },
  time: { fields: {} },
  webhook: { fields: {} },
  'light.turned_on': { target: { entity: { domain: 'light' } }, fields: { behavior: { selector: { select: { options: ['any', 'first', 'last'] } } } } },
}

export const SERVICES: Record<string, string[]> = {
  light: ['turn_on', 'turn_off', 'toggle'],
  switch: ['turn_on', 'turn_off'],
  notify: ['mobile_app', 'notify'],
  automation: ['turn_on', 'turn_off', 'trigger', 'reload'],
  input_boolean: ['turn_on', 'turn_off'],
  shell_command: ['riavvia'],
  homeassistant: ['restart', 'turn_on', 'turn_off'],
  button: ['press'],
  lock: ['lock', 'unlock'],
  mqtt: ['publish'],
}

export interface FakeHA extends HAReader {
  calls: Json[]
  history: Record<string, Json[]>
  /** Voci del Registro attività (logbook/get_events), con when in secondi. */
  logbook: Json[]
}

/** Utenti finti: una persona, il Supervisor (sistema) e il Cloud (voce = persona). */
export const USERS: Json[] = [
  { id: 'a'.repeat(32), name: 'Demo', username: 'demo', is_owner: true, is_active: true, system_generated: false, group_ids: ['system-admin'] },
  { id: 'b'.repeat(32), name: 'Supervisor', is_owner: false, is_active: true, system_generated: true, group_ids: ['system-admin'] },
  { id: 'c'.repeat(32), name: 'Home Assistant Cloud', is_owner: false, is_active: true, system_generated: true, group_ids: [] },
  { id: 'd'.repeat(32), name: 'Node-RED', username: 'nodered', is_owner: false, is_active: true, system_generated: false, group_ids: ['system-admin'] },
]

export function fakeHA(overrides: { states?: Map<string, HAState>; registries?: Registries } = {}): FakeHA {
  const registries = overrides.registries ?? fakeRegistries()
  const states = overrides.states ?? fakeStates()
  const calls: Json[] = []
  const history: Record<string, Json[]> = {}
  const logbook: Json[] = []
  return {
    calls,
    history,
    logbook,
    config: async () => ({ location_name: 'Casa Demo', version: '2026.9.3', time_zone: 'Europe/Rome', language: 'it', country: 'IT', unit_system: { temperature: '°C', length: 'km' } }),
    registries: async () => registries,
    states: async () => states,
    async call<T>(msg: Json): Promise<T> {
      calls.push(msg)
      switch (msg.type) {
        case 'get_config':
          return { location_name: 'Casa Demo', version: '2026.9.3', time_zone: 'Europe/Rome', country: 'IT', latitude: 41.9, longitude: 12.5, unit_system: {} } as T
        case 'config/auth/list':
          return USERS as T
        case 'logbook/get_events': {
          const s = Date.parse(msg.start_time) / 1000
          const e = Date.parse(msg.end_time) / 1000
          const ids = new Set(msg.entity_ids as string[])
          return logbook.filter((r) => r.when >= s && r.when < e && ids.has(r.entity_id)) as T
        }
        case 'automation/config':
          if (msg.entity_id === 'automation.luci_sera') return { config: AUTOMATION_CONFIG } as T
          return { config: { alias: 'Vecchia', triggers: [], actions: [] } } as T
        case 'script/config':
          return { config: {} } as T
        case 'search/related':
          if (msg.item_id === 'light.lampada_arco') return { automation: ['automation.luci_sera'], scene: [] } as T
          return {} as T
        case 'trace/list':
          return [
            { run_id: 'a', state: 'stopped', script_execution: 'failed_conditions', timestamp: { start: '2026-10-13T17:30:00+00:00', finish: '2026-10-13T17:30:00.1+00:00' }, trigger: 'sunset', last_step: 'condition/0' },
            { run_id: 'b', state: 'stopped', script_execution: 'finished', timestamp: { start: '2026-10-12T17:31:00+00:00', finish: '2026-10-12T17:31:01+00:00' }, trigger: 'sunset', last_step: 'action/1' },
          ] as T
        case 'history/history_during_period':
          return Object.fromEntries((msg.entity_ids as string[]).map((id) => [id, history[id] ?? []])) as T
        case 'recorder/statistics_during_period':
          return {} as T
        case 'validate_config': {
          const out: Json = {}
          for (const key of ['triggers', 'conditions', 'actions']) {
            if (!(key in msg)) continue
            const bad = JSON.stringify(msg[key]).includes('NON_VALIDO')
            out[key] = bad ? { valid: false, error: `valore non valido in ${key}` } : { valid: true, error: null }
          }
          return out as T
        }
        case 'manifest/get':
          return { name: 'Lumi', documentation: 'https://www.home-assistant.io/integrations/lumi', iot_class: 'local_push', integration_type: 'hub' } as T
        case 'device_automation/trigger/list':
          return [{ platform: 'device', domain: 'lumi', type: 'turned_on', device_id: msg.device_id, entity_id: 'light.lampada_arco', metadata: {} }] as T
        default:
          throw new Error(`comando non simulato: ${msg.type}`)
      }
    },
    async subscribeOnce(msg: Json) {
      calls.push(msg)
      return TRIGGER_CATALOG
    },
    services: async () => new Map(Object.entries(SERVICES).map(([d, list]) => [d, new Set(list)])),
    triggerCatalog: async () => TRIGGER_CATALOG,
  }
}
