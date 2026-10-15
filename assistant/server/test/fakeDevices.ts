import type { HAReader } from '../src/ha/data.ts'
import { toAreaEntry, toDeviceEntry, toEntityEntry, type HAState, type Registries } from '../src/ha/types.ts'
import { fakeHA } from './fakeHome.ts'

// Casa sintetica per la pagina Dispositivi: stessi modelli visti da più integrazioni (locale e
// cloud), codici modello al posto del nome, dispositivi da escludere. Nomi e aree inventati:
// servono a verificare che non escano mai verso la ricerca web.

type Json = Record<string, any>

export const SECRET_NAMES = ['Radar Demo Salotto', 'Relè Demo Cantina', 'Hub Demo Studio', 'Zona Demo Segreta']

const T0 = '2026-10-14T08:00:00+00:00'
const st = (entity_id: string, state: string, attributes: Json = {}): HAState => ({ entity_id, state, attributes, last_changed: T0, last_updated: T0 })
const ent = (entity_id: string, platform: string, device_id: string, extra: Json = {}) =>
  toEntityEntry({ entity_id, platform, device_id, area_id: null, disabled_by: null, hidden_by: null, entity_category: null, name: null, original_name: null, labels: [], categories: {}, ...extra })
const dev = (id: string, extra: Json) =>
  toDeviceEntry({ id, name: null, name_by_user: null, manufacturer: null, model: null, model_id: null, area_id: 'zona', disabled_by: null, entry_type: null, primary_config_entry: null, config_entries: [], via_device_id: null, sw_version: null, labels: [], ...extra })

export const MANIFESTS: Record<string, Json> = {
  homekit_controller: { name: 'HomeKit Device', documentation: 'https://www.home-assistant.io/integrations/homekit_controller', iot_class: 'local_push' },
  aqara_cloud: { name: 'Aqara Cloud', documentation: 'https://github.com/esempio/aqara-cloud', iot_class: 'cloud_polling' },
  shelly: { name: 'Shelly', documentation: 'https://www.home-assistant.io/integrations/shelly', iot_class: 'local_push' },
  smartthings: { name: 'SmartThings', documentation: 'https://www.home-assistant.io/integrations/smartthings', iot_class: 'cloud_push' },
  switchbot: { name: 'SwitchBot Bluetooth', documentation: 'https://www.home-assistant.io/integrations/switchbot', iot_class: 'local_push' },
  switchbot_cloud: { name: 'SwitchBot Cloud', documentation: 'https://www.home-assistant.io/integrations/switchbot_cloud', iot_class: 'cloud_polling' },
}

export function devicesRegistries(): Registries {
  const devices = [
    dev('d_fp_hk', { name: SECRET_NAMES[0], manufacturer: 'Lumi United Technology Co., Ltd', model: 'Presence Sensor FP2', model_id: 'PS-S02D', primary_config_entry: 'ce_hk', config_entries: ['ce_hk'], sw_version: '1.2.7' }),
    dev('d_fp_cloud', { name: 'Radar cloud', manufacturer: 'Aqara', model: 'Presence Sensor FP2', primary_config_entry: 'ce_aq', config_entries: ['ce_aq'] }),
    dev('d_2pm', { name: SECRET_NAMES[1], manufacturer: 'Shelly', model: 'Shelly 2PM Gen4', model_id: 'S4SW-002P16EU', primary_config_entry: 'ce_sh', config_entries: ['ce_sh'], sw_version: '1.6.2' }),
    dev('d_2pm_st', { name: 'Relè via SmartThings', manufacturer: 'Shelly', model: 'S4SW-002P16EU', primary_config_entry: 'ce_st', config_entries: ['ce_st'] }),
    dev('d_hub_ble', { name: SECRET_NAMES[2], manufacturer: 'SwitchBot', model: 'SwitchBot Hub 2', primary_config_entry: 'ce_sb', config_entries: ['ce_sb'] }),
    dev('d_hub_cloud', { name: 'Hub cloud', manufacturer: 'Woan Technology', model: 'Hub 2', primary_config_entry: 'ce_sbc', config_entries: ['ce_sbc'] }),
    // Esclusi: disabilitato, servizio, senza modello, solo entità di telecamera (privacy).
    dev('d_off', { name: 'Spento', manufacturer: 'Shelly', model: 'Plus 1', primary_config_entry: 'ce_sh', config_entries: ['ce_sh'], disabled_by: 'user' }),
    dev('d_srv', { name: 'Servizio', manufacturer: 'Shelly', model: 'Cloud', primary_config_entry: 'ce_sh', config_entries: ['ce_sh'], entry_type: 'service' }),
    dev('d_nomodel', { name: 'Senza modello', manufacturer: 'Shelly', primary_config_entry: 'ce_sh', config_entries: ['ce_sh'] }),
    dev('d_cam', { name: 'Telecamera', manufacturer: 'Cam', model: 'C9', primary_config_entry: 'ce_sh', config_entries: ['ce_sh'] }),
  ]
  const entities = [
    ent('binary_sensor.radar_zona_1', 'homekit_controller', 'd_fp_hk'),
    ent('binary_sensor.radar_zona_2', 'homekit_controller', 'd_fp_hk'),
    ent('sensor.radar_lux', 'homekit_controller', 'd_fp_hk'),
    ent('binary_sensor.radar_cloud', 'aqara_cloud', 'd_fp_cloud'),
    ent('switch.rele_0', 'shelly', 'd_2pm'),
    ent('sensor.rele_0_potenza', 'shelly', 'd_2pm'),
    ent('switch.rele_st', 'smartthings', 'd_2pm_st'),
    ent('sensor.hub_temperatura', 'switchbot', 'd_hub_ble'),
    ent('sensor.hub_cloud_temperatura', 'switchbot_cloud', 'd_hub_cloud'),
    ent('switch.spento', 'shelly', 'd_off'),
    ent('switch.servizio', 'shelly', 'd_srv'),
    ent('switch.senza_modello', 'shelly', 'd_nomodel'),
    ent('camera.telecamera', 'shelly', 'd_cam'),
  ]
  return {
    entities,
    devices,
    areas: [toAreaEntry({ area_id: 'zona', name: SECRET_NAMES[3], aliases: [] })],
    floors: [],
    labels: [],
    automationCategories: [],
    configEntryDomain: { ce_hk: 'homekit_controller', ce_aq: 'aqara_cloud', ce_sh: 'shelly', ce_st: 'smartthings', ce_sb: 'switchbot', ce_sbc: 'switchbot_cloud' },
    loadedAt: 0,
  }
}

export function devicesStates(): Map<string, HAState> {
  const list = [
    st('binary_sensor.radar_zona_1', 'on', { device_class: 'occupancy', friendly_name: `${SECRET_NAMES[0]} zona 1` }),
    st('binary_sensor.radar_zona_2', 'off', { device_class: 'occupancy' }),
    st('sensor.radar_lux', '120', { device_class: 'illuminance', unit_of_measurement: 'lx' }),
    st('binary_sensor.radar_cloud', 'on', { device_class: 'occupancy' }),
    st('switch.rele_0', 'off'),
    st('sensor.rele_0_potenza', '0', { device_class: 'power', unit_of_measurement: 'W' }),
    st('switch.rele_st', 'off'),
    st('sensor.hub_temperatura', '21.5', { device_class: 'temperature', unit_of_measurement: '°C' }),
    st('sensor.hub_cloud_temperatura', '21.4', { device_class: 'temperature', unit_of_measurement: '°C' }),
    st('switch.spento', 'off'),
    st('switch.servizio', 'off'),
    st('switch.senza_modello', 'off'),
    st('camera.telecamera', 'idle'),
  ]
  return new Map(list.map((s) => [s.entity_id, s]))
}

export function devicesHA(): HAReader & { calls: Json[] } {
  const base = fakeHA({ registries: devicesRegistries(), states: devicesStates() })
  return {
    ...base,
    async call<T>(msg: Json): Promise<T> {
      base.calls.push(msg)
      if (msg.type === 'manifest/get') {
        const m = MANIFESTS[msg.integration as string]
        if (!m) throw new Error('integrazione sconosciuta')
        return m as T
      }
      if (msg.type === 'device_automation/trigger/list') {
        return [
          { platform: 'device', domain: 'binary_sensor', type: 'occupied', device_id: msg.device_id, entity_id: 'binary_sensor.radar_zona_1' },
          { platform: 'device', domain: 'binary_sensor', type: 'not_occupied', device_id: msg.device_id, entity_id: 'binary_sensor.radar_zona_1' },
        ] as T
      }
      return base.call<T>(msg)
    },
  }
}
