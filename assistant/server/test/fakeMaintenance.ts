import type { HAReader } from '../src/ha/data.ts'
import type { RegistryWriter } from '../src/ha/writer.ts'
import { toAreaEntry, toDeviceEntry, toEntityEntry, type HAState, type Registries } from '../src/ha/types.ts'
import { fakeHA } from './fakeHome.ts'

// Casa sintetica per la Manutenzione: un caso per regola (offline da tanto e da poco, entità
// orfane, stanza dell'app Hue, nome che cita un'altra stanza, senza area, doppione locale/cloud,
// integrazioni in errore, batterie, firmware). Nomi e aree inventati.

type Json = Record<string, any>

export const M_NOW = new Date('2026-10-15T12:00:00Z')
const DAY = 86_400_000
const T0 = '2026-10-14T08:00:00+00:00'
const sec = (ms: number) => ms / 1000

const st = (entity_id: string, state: string, attributes: Json = {}): HAState => ({ entity_id, state, attributes, last_changed: T0, last_updated: T0 })
const ent = (entity_id: string, platform: string, device_id: string | null, config_entry_id: string | null, extra: Json = {}) =>
  toEntityEntry({ entity_id, platform, device_id, config_entry_id, area_id: null, disabled_by: null, hidden_by: null, entity_category: null, name: null, original_name: null, labels: [], categories: {}, ...extra })
const dev = (id: string, name: string, entry: string, area: string | null, extra: Json = {}) =>
  toDeviceEntry({ id, name, name_by_user: null, manufacturer: 'Demo', model: 'M1', model_id: null, area_id: area, disabled_by: null, entry_type: null, config_entry_id: entry, via_device_id: null, sw_version: null, labels: [], ...extra })

/** id di dispositivo come quelli veri (32 caratteri esadecimali). */
export const D = {
  vecchio: 'a1'.padEnd(32, '0'),
  recente: 'a2'.padEnd(32, '0'),
  letto: 'a3'.padEnd(32, '0'),
  arco: 'a4'.padEnd(32, '0'),
  termostato: 'a5'.padEnd(32, '0'),
  garage: 'a6'.padEnd(32, '0'),
  rele: 'a7'.padEnd(32, '0'),
  presa: 'a8'.padEnd(32, '0'),
  tvLocale: 'a9'.padEnd(32, '0'),
  tvCloud: 'aa'.padEnd(32, '0'),
  porta: 'ab'.padEnd(32, '0'),
  lavatrice: 'ac'.padEnd(32, '0'),
  meross: 'ad'.padEnd(32, '0'),
  serratura: 'ae'.padEnd(32, '0'),
  telefono: 'af'.padEnd(32, '0'),
}

export const M_ENTRIES: Json[] = [
  { entry_id: 'ce_zha', domain: 'zha', title: 'Zigbee', state: 'loaded', reason: null, disabled_by: null, supports_remove_device: true, source: 'user' },
  { entry_id: 'ce_hue', domain: 'hue', title: 'Bridge', state: 'loaded', reason: null, disabled_by: null, supports_remove_device: false, source: 'zeroconf' },
  { entry_id: 'ce_shelly', domain: 'shelly', title: 'Shelly', state: 'loaded', reason: null, disabled_by: null, supports_remove_device: false, source: 'zeroconf' },
  { entry_id: 'ce_tuya', domain: 'tuya', title: 'Tuya', state: 'loaded', reason: null, disabled_by: null, supports_remove_device: true, source: 'user' },
  { entry_id: 'ce_meross', domain: 'meross_cloud', title: 'Meross', state: 'setup_retry', reason: 'Timeout del server', disabled_by: null, supports_remove_device: false, source: 'user' },
  { entry_id: 'ce_ring', domain: 'ring', title: 'Ring', state: 'setup_error', reason: 'Accesso scaduto', disabled_by: null, supports_remove_device: false, source: 'user' },
  { entry_id: 'ce_spenta', domain: 'tuya', title: 'Tuya vecchia', state: 'not_loaded', reason: null, disabled_by: 'user', supports_remove_device: true, source: 'user' },
  { entry_id: 'ce_app', domain: 'mobile_app', title: 'Telefono', state: 'loaded', reason: null, disabled_by: null, supports_remove_device: true, source: 'registration' },
]

export const M_MANIFESTS: Record<string, Json> = {
  zha: { name: 'Zigbee Home Automation', iot_class: 'local_polling' },
  hue: { name: 'Philips Hue', iot_class: 'local_push' },
  shelly: { name: 'Shelly', iot_class: 'local_push' },
  tuya: { name: 'Tuya', iot_class: 'cloud_push' },
  meross_cloud: { name: 'Meross Cloud', iot_class: 'cloud_polling' },
  ring: { name: 'Ring', iot_class: 'cloud_polling' },
  mobile_app: { name: 'Mobile App', iot_class: 'local_push' },
}

export function maintenanceRegistries(): Registries {
  const devices = [
    dev(D.vecchio, 'Sensore porta vecchio', 'ce_zha', 'camera'),
    dev(D.recente, 'Presa recente', 'ce_zha', 'camera'),
    dev(D.letto, 'Lampada letto', 'ce_zha', 'camera'),
    dev(D.arco, 'Lampada arco', 'ce_hue', 'soggiorno'),
    dev(D.termostato, 'Termostato Camera ospiti', 'ce_zha', 'camera'),
    dev(D.garage, 'Sensore garage', 'ce_zha', null),
    dev(D.rele, 'Relè 3', 'ce_shelly', null),
    dev(D.presa, 'Presa smart', 'ce_shelly', null),
    dev(D.tvLocale, 'TV', 'ce_shelly', 'soggiorno'),
    dev(D.tvCloud, 'TV cloud', 'ce_tuya', 'soggiorno'),
    dev(D.porta, 'Sensore porta ingresso', 'ce_zha', 'soggiorno'),
    dev(D.lavatrice, 'Presa lavatrice', 'ce_shelly', 'garage'),
    dev(D.meross, 'Presa meross', 'ce_meross', 'cucina'),
    dev(D.serratura, 'Serratura ingresso', 'ce_zha', 'soggiorno'),
    dev(D.telefono, 'Telefono di prova', 'ce_app', null),
  ]
  const entities = [
    ent('binary_sensor.porta_vecchia', 'zha', D.vecchio, 'ce_zha'),
    ent('sensor.porta_vecchia_batteria', 'zha', D.vecchio, 'ce_zha', { entity_category: 'diagnostic' }),
    ent('button.porta_vecchia_identifica', 'zha', D.vecchio, 'ce_zha', { entity_category: 'config' }),
    ent('switch.presa_recente', 'zha', D.recente, 'ce_zha'),
    ent('light.lampada_letto', 'zha', D.letto, 'ce_zha'),
    ent('sensor.lampada_letto_vecchio_nome', 'zha', D.letto, 'ce_zha'),
    ent('light.lampada_arco', 'hue', D.arco, 'ce_hue'),
    ent('light.cucina', 'hue', null, 'ce_hue'),
    ent('light.zona_relax', 'hue', null, 'ce_hue'),
    ent('climate.termostato_ospiti', 'zha', D.termostato, 'ce_zha'),
    ent('binary_sensor.garage_porta', 'zha', D.garage, 'ce_zha'),
    ent('switch.rele_3', 'shelly', D.rele, 'ce_shelly', { area_id: 'cucina' }),
    ent('switch.presa_smart', 'shelly', D.presa, 'ce_shelly'),
    ent('media_player.tv', 'shelly', D.tvLocale, 'ce_shelly'),
    ent('media_player.tv_cloud', 'tuya', D.tvCloud, 'ce_tuya'),
    ent('binary_sensor.porta_ingresso', 'zha', D.porta, 'ce_zha'),
    ent('sensor.porta_ingresso_batteria', 'zha', D.porta, 'ce_zha', { entity_category: 'diagnostic' }),
    ent('switch.lavatrice', 'shelly', D.lavatrice, 'ce_shelly'),
    ent('update.lavatrice_firmware', 'shelly', D.lavatrice, 'ce_shelly', { entity_category: 'config' }),
    ent('switch.presa_meross', 'meross_cloud', D.meross, 'ce_meross'),
    ent('lock.ingresso', 'zha', D.serratura, 'ce_zha'),
    ent('sensor.telefono_batteria', 'mobile_app', D.telefono, 'ce_app'),
    ent('sensor.template_vecchio', 'template', null, null),
  ]
  return {
    entities,
    devices,
    areas: [
      toAreaEntry({ area_id: 'soggiorno', name: 'Soggiorno', aliases: [] }),
      toAreaEntry({ area_id: 'cucina', name: 'Cucina', aliases: ['Angolo cottura'] }),
      toAreaEntry({ area_id: 'camera', name: 'Camera', aliases: [] }),
      toAreaEntry({ area_id: 'camera_ospiti', name: 'Camera ospiti', aliases: [] }),
      toAreaEntry({ area_id: 'garage', name: 'Garage', aliases: [] }),
    ],
    floors: [],
    labels: [],
    automationCategories: [],
    configEntryDomain: Object.fromEntries(M_ENTRIES.map((e) => [e.entry_id, e.domain])),
    compositeDevices: { ['c0'.padEnd(32, '0')]: { splitIds: [D.tvLocale, D.tvCloud], primaryId: D.tvLocale } },
    loadedAt: 0,
  }
}

export function maintenanceStates(): Map<string, HAState> {
  const list = [
    st('binary_sensor.porta_vecchia', 'unavailable', { device_class: 'door', friendly_name: 'Porta vecchia' }),
    st('sensor.porta_vecchia_batteria', 'unavailable', { device_class: 'battery', unit_of_measurement: '%' }),
    st('button.porta_vecchia_identifica', 'unknown'),
    st('switch.presa_recente', 'unavailable'),
    st('light.lampada_letto', 'on'),
    st('sensor.lampada_letto_vecchio_nome', 'unavailable', { restored: true, friendly_name: 'Vecchio nome' }),
    st('light.lampada_arco', 'off', { friendly_name: 'Lampada arco' }),
    st('light.cucina', 'off', { is_hue_group: true, hue_type: 'room', friendly_name: 'Cucina', entity_id: ['light.lampada_arco'] }),
    st('light.zona_relax', 'off', { is_hue_group: true, hue_type: 'zone', friendly_name: 'Garage', entity_id: ['light.lampada_letto'] }),
    st('climate.termostato_ospiti', 'heat'),
    st('binary_sensor.garage_porta', 'off', { device_class: 'garage_door' }),
    st('switch.rele_3', 'off'),
    st('switch.presa_smart', 'on'),
    st('media_player.tv', 'off'),
    st('media_player.tv_cloud', 'off'),
    st('binary_sensor.porta_ingresso', 'off', { device_class: 'door' }),
    st('sensor.porta_ingresso_batteria', '8', { device_class: 'battery', unit_of_measurement: '%' }),
    st('switch.lavatrice', 'on'),
    st('update.lavatrice_firmware', 'on', { installed_version: '1.6.2', latest_version: '1.7.0', title: 'Shelly' }),
    st('switch.presa_meross', 'unavailable', { restored: true }),
    st('lock.ingresso', 'unavailable'),
    st('sensor.telefono_batteria', '5', { device_class: 'battery', unit_of_measurement: '%' }),
    st('sensor.template_vecchio', 'unavailable', { restored: true }),
    st('sun.sun', 'above_horizon'),
  ]
  return new Map(list.map((s) => [s.entity_id, s]))
}

export interface MaintenanceFake {
  ha: HAReader & { calls: Json[] }
  writer: RegistryWriter
  writes: Json[]
  registries: Registries
  states: Map<string, HAState>
}

export function maintenanceHome(now = M_NOW.getTime()): MaintenanceFake {
  const registries = maintenanceRegistries()
  const states = maintenanceStates()
  const base = fakeHA({ registries, states })
  const start = now - 30 * DAY
  // Storico: sun.sun copre tutti i 30 giorni; la presa ha risposto fino a 3 giorni fa.
  base.history['sun.sun'] = [{ s: 'below_horizon', lu: sec(start) }, { s: 'above_horizon', lu: sec(now - DAY) }]
  base.history['switch.presa_recente'] = [{ s: 'on', lu: sec(now - 10 * DAY) }, { s: 'unavailable', lu: sec(now - 3 * DAY) }]
  base.history['binary_sensor.porta_vecchia'] = [{ s: 'unavailable', lu: sec(start) }]
  const ha = {
    ...base,
    async call<T>(msg: Json): Promise<T> {
      switch (msg.type) {
        case 'config_entries/get':
          base.calls.push(msg)
          return M_ENTRIES as T
        case 'config_entries/flow/progress':
          base.calls.push(msg)
          return [
            { flow_id: 'f1', handler: 'ring', step_id: 'reauth_confirm', context: { source: 'reauth', entry_id: 'ce_ring' } },
            { flow_id: 'f2', handler: 'zha', step_id: 'confirm', context: { source: 'zeroconf' } },
          ] as T
        case 'manifest/get': {
          base.calls.push(msg)
          const m = M_MANIFESTS[msg.integration as string]
          if (!m) throw new Error('integrazione sconosciuta')
          return m as T
        }
        case 'recorder/statistics_during_period': {
          base.calls.push(msg)
          // La batteria del sensore vecchio ha dato l'ultimo valore 60 giorni fa.
          const ids = msg.statistic_ids as string[]
          return (ids.includes('sensor.porta_vecchia_batteria') ? { 'sensor.porta_vecchia_batteria': [{ start: now - 61 * DAY, end: now - 60 * DAY, mean: 40 }] } : {}) as T
        }
        case 'search/related':
          base.calls.push(msg)
          if (msg.item_type === 'device' && msg.item_id === D.vecchio) return { automation: ['automation.avviso_porta'], script: [] } as T
          if (msg.item_type === 'entity' && msg.item_id === 'sensor.lampada_letto_vecchio_nome') return { automation: ['automation.luci_notte'] } as T
          return {} as T
        default:
          return base.call<T>(msg)
      }
    },
  }
  const writes: Json[] = []
  // Lo scrittore finto aggiorna i registri come farebbe Home Assistant.
  const writer: RegistryWriter = {
    async updateDevice(deviceId, patch) {
      writes.push({ op: 'update', deviceId, ...patch })
      const d = registries.devices.find((x) => x.id === deviceId)!
      if ('area_id' in patch) d.area_id = patch.area_id ?? null
      if ('disabled_by' in patch) d.disabled_by = patch.disabled_by ?? null
    },
    async removeDevice(deviceId, configEntryId) {
      writes.push({ op: 'removeDevice', deviceId, configEntryId })
      registries.devices = registries.devices.filter((x) => x.id !== deviceId)
    },
    async removeEntity(entityId) {
      writes.push({ op: 'removeEntity', entityId })
      registries.entities = registries.entities.filter((x) => x.entity_id !== entityId)
      states.delete(entityId)
    },
  }
  return { ha, writer, writes, registries, states }
}
