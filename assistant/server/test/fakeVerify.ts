import type { HAState } from '../src/ha/types.ts'
import { toEntityEntry } from '../src/ha/types.ts'
import { fakeHA, fakeRegistries, fakeStates, type FakeHA } from './fakeHome.ts'
import { fakeWriter, type FakeWriter } from './fakeWriter.ts'

// Casa sintetica per "Verifica": un'automazione per ogni caso noto (riferimento rinominato,
// dispositivo sparito, non caricata, trigger "rumoroso", id concatenato, time_pattern
// sbagliato, soglia irraggiungibile, attivazioni ignorate, blueprint, YAML, sintassi vecchia)
// e un Registro attività con oscillazioni e correzioni manuali. Solo dati inventati.

type Json = Record<string, any>

export const VNOW = Date.parse('2026-10-14T18:00:00Z')
const iso = (msAgo: number) => new Date(VNOW - msAgo).toISOString()
const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

export const EDITOR: Record<string, Json> = {
  '9000000000001': {
    alias: 'Pompa giardino la sera',
    description: 'Accende la pompa alle 20',
    trigger: [{ platform: 'time', at: '20:00:00' }],
    action: [{ service: 'switch.turn_on', target: { entity_id: 'switch.pompa_giardino' } }, { action: 'notify.mobile_app', data: { message: "Pompa {{ states('switch.pompa_giardino') }}" } }],
    mode: 'single',
  },
  '9000000000002': {
    alias: 'Aggiorna stanza Demo',
    description: 'Copia la stanza del sensore BLE',
    triggers: [{ trigger: 'state', entity_id: 'sensor.ble_stanza_demo' }],
    actions: [{ action: 'input_boolean.turn_on', target: { entity_id: 'input_boolean.ospiti' } }],
    mode: 'single',
  },
  '9000000000003': {
    alias: 'Assenza soggiorno',
    description: 'Spegne dopo 5 o 30 minuti',
    triggers: [
      { trigger: 'state', entity_id: 'binary_sensor.radar_presenza', to: 'off', for: { minutes: 5 }, id: '5' },
      { trigger: 'state', entity_id: 'binary_sensor.radar_presenza', to: 'off', for: { minutes: 30 }, id: '30' },
    ],
    actions: [{ choose: [{ conditions: [{ condition: 'trigger', id: ['5', '530'] }], sequence: [{ action: 'light.turn_off', target: { entity_id: 'light.lampada_arco' } }] }] }],
    mode: 'single',
  },
  '9000000000004': {
    alias: '5 min lavatrice',
    description: 'Controlla la lavatrice',
    triggers: [{ trigger: 'time_pattern', hours: '1' }],
    actions: [{ action: 'switch.turn_off', target: { entity_id: 'switch.presa_lavatrice' } }],
    mode: 'single',
  },
  '9000000000005': {
    alias: 'Luce relè',
    description: 'Ricontrolla la luce',
    triggers: [{ trigger: 'time_pattern', seconds: '10', id: '10sec' }],
    actions: [{ action: 'light.turn_on', target: { entity_id: 'light.rele_camera' } }],
    mode: 'single',
  },
  '9000000000006': {
    alias: 'Lavatrice finita',
    description: 'Avvisa quando la potenza supera 40 W',
    triggers: [{ trigger: 'numeric_state', entity_id: 'sensor.presa_lavatrice_potenza', above: 40 }],
    actions: [{ delay: '00:05:00' }, { action: 'notify.mobile_app', data: { message: 'fatto' } }],
    mode: 'single',
  },
  '9000000000007': {
    alias: 'Pulsante sparito',
    description: 'Trigger di un dispositivo rimosso',
    triggers: [{ trigger: 'device', device_id: 'dev_sparito', domain: 'zha', type: 'remote_button_short_press', subtype: 'turn_on' }],
    actions: [{ action: 'light.toggle', target: { entity_id: 'light.lampada_arco' } }],
    mode: 'single',
  },
  '9000000000008': {
    alias: 'Rotta',
    description: 'Non si carica',
    triggers: [{ trigger: 'state', entity_id: 'light.lampada_arco', to: 'NON_VALIDO_NON_CARICABILE' }],
    actions: [{ action: 'light.turn_off', target: { entity_id: 'light.lampada_arco' } }],
    mode: 'single',
  },
  '9000000000009': {
    alias: 'Luci controllo demo',
    description: 'Accende e spegne la luce camera con la presenza',
    triggers: [{ trigger: 'state', entity_id: 'binary_sensor.radar_presenza' }],
    actions: [{ action: 'light.toggle', target: { entity_id: 'light.rele_camera' } }],
    mode: 'single',
  },
  '9000000000010': {
    use_blueprint: { path: 'demo/notifica.yaml', input: { sensore: 'binary_sensor.porta_vecchia', luce: 'light.lampada_arco' } },
    alias: 'Notifica porta (blueprint)',
  },
}

export function verifyHome(): { ha: FakeHA; writer: FakeWriter; states: Map<string, HAState> } {
  const states = fakeStates()
  const extra: HAState[] = [
    { entity_id: 'switch.shelly_uscita_0', state: 'off', attributes: { friendly_name: 'Pompa giardino' }, last_changed: iso(HOUR), last_updated: iso(HOUR) },
    { entity_id: 'sensor.ble_stanza_demo', state: 'soggiorno', attributes: { friendly_name: 'Stanza Demo', distance: 2.1 }, last_changed: iso(MIN), last_updated: iso(1000) },
    { entity_id: 'sensor.sensore_scarico', state: 'unavailable', attributes: { friendly_name: 'Sensore scarico' }, last_changed: iso(3 * DAY), last_updated: iso(3 * DAY) },
  ]
  for (const s of extra) states.set(s.entity_id, s)
  const writer = fakeWriter(states, EDITOR)
  // Un'automazione nei packages (YAML): ha un id ma l'editor non la conosce.
  const yamlConfig = {
    id: 'pkg_umidita',
    alias: 'Umidità (package)',
    trigger: [{ platform: 'state', entity_id: 'sensor.sensore_scarico', to: 'on' }],
    action: [{ service: 'light.turn_on', target: { entity_id: 'light.lampada_arco' } }],
  }
  states.set('automation.umidita_package', { entity_id: 'automation.umidita_package', state: 'on', attributes: { id: 'pkg_umidita', friendly_name: 'Umidità (package)' }, last_changed: iso(DAY), last_updated: iso(DAY) })
  // Le automazioni della casa base non servono qui.
  states.delete('automation.luci_sera')
  states.delete('automation.vecchia')

  const registries = fakeRegistries()
  registries.entities.push(toEntityEntry({ entity_id: 'switch.shelly_uscita_0', platform: 'shelly', id: 'f'.repeat(32) }))
  const ha = fakeHA({ states, registries })
  const base = ha.call.bind(ha)
  const idOf = (entityId: string) => states.get(entityId)?.attributes.id as string | undefined
  const traces: Json[] = []
  const trace = (item: string, msAgo: number, execution: string, error?: string) =>
    traces.push({ domain: 'automation', item_id: item, run_id: `${item}-${msAgo}`, state: 'stopped', script_execution: execution, timestamp: { start: iso(msAgo), finish: iso(msAgo - 100) }, ...(error ? { error } : {}) })
  // Sensore BLE: 5 esecuzioni in 8 secondi (scatta per ogni attributo).
  for (const s of [8, 6, 4, 2, 1]) trace('9000000000002', s * 1000, 'finished')
  // Lavatrice: attivazioni scartate mentre aspetta il delay.
  trace('9000000000006', 2 * HOUR, 'finished')
  trace('9000000000006', 2 * HOUR - MIN, 'failed_single')
  trace('9000000000006', 2 * HOUR - 2 * MIN, 'failed_single')
  // Errore in esecuzione.
  trace('9000000000004', DAY, 'error', 'Unable to find referenced entities switch.presa_vecchia')

  ha.call = async <T>(msg: Json): Promise<T> => {
    if (msg.type === 'automation/config') {
      if (msg.entity_id === 'automation.umidita_package') return { config: yamlConfig } as T
      const id = idOf(msg.entity_id)
      const cfg = id ? writer.files.get(id) : undefined
      if (!cfg) throw new Error('not found')
      return { config: structuredClone(cfg) } as T
    }
    if (msg.type === 'trace/list') {
      ha.calls.push(msg)
      return traces as T
    }
    if (msg.type === 'recorder/statistics_during_period') {
      ha.calls.push(msg)
      const out: Json = {}
      if ((msg.statistic_ids as string[]).includes('sensor.presa_lavatrice_potenza')) {
        out['sensor.presa_lavatrice_potenza'] = Array.from({ length: 30 }, (_, i) => ({ start: VNOW - (30 - i) * DAY, min: 0.5, max: 25 + (i % 5) }))
      }
      return out as T
    }
    return base<T>(msg)
  }

  // Registro attività: "Luci controllo demo" accende e spegne a pochi secondi (3 giorni);
  // dopo che "5 min lavatrice" spegne la presa, qualcuno la riaccende a mano.
  const auto = (entityId: string) => ({ context_event_type: 'automation_triggered', context_entity_id: entityId })
  const lc = [...states.values()].find((s) => s.attributes.id === '9000000000009')!.entity_id
  const lav = [...states.values()].find((s) => s.attributes.id === '9000000000004')!.entity_id
  for (let d = 1; d <= 3; d++) {
    for (let k = 0; k < 5; k++) {
      const t0 = VNOW - d * DAY + k * 10 * MIN
      ha.logbook.push({ when: t0 / 1000, entity_id: 'light.rele_camera', state: 'on', ...auto(lc) })
      ha.logbook.push({ when: (t0 + 30_000) / 1000, entity_id: 'light.rele_camera', state: 'off', ...auto(lc) })
    }
    const t1 = VNOW - d * DAY + 5 * HOUR
    ha.logbook.push({ when: t1 / 1000, entity_id: 'switch.presa_lavatrice', state: 'off', ...auto(lav) })
    ha.logbook.push({ when: (t1 + 2 * MIN) / 1000, entity_id: 'switch.presa_lavatrice', state: 'on', context_user_id: 'a'.repeat(32) })
  }
  return { ha, writer, states }
}
