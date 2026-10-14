import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildInventory, collectEntityRefs, renderInventory } from '../src/inventory/inventory.ts'
import { DEFAULT_CONSENTS, sanitizeAttributes, sanitizeState, scrubString, type Consents } from '../src/inventory/privacy.ts'
import { buildHomeSnapshot, resetSnapshotCache } from '../src/inventory/snapshot.ts'
import { buildSystemPrompt } from '../src/claude/prompt.ts'
import { AUTOMATION_CONFIG, fakeHA, fakeRegistries, fakeStates } from './fakeHome.ts'

const ALL: Consents = { posizione: true, telecamere: true, appMobile: true }

function ids(consents: Consents = DEFAULT_CONSENTS, referenced = new Set<string>()) {
  const inv = buildInventory({ registries: fakeRegistries(), states: fakeStates(), consents, referenced })
  return { inv, set: new Set(inv.entities.map((e) => e.entity_id)) }
}

test('inventario: regole R1–R5 su dati sintetici', () => {
  const { set } = ids()
  for (const id of ['light.lampada_arco', 'binary_sensor.radar_presenza', 'sensor.radar_illuminamento', 'switch.presa_lavatrice', 'sensor.presa_lavatrice_potenza', 'light.rele_camera', 'input_boolean.ospiti', 'sensor.media_temperatura', 'person.demo', 'zone.home', 'sun.sun']) {
    assert.ok(set.has(id), `${id} dovrebbe esserci`)
  }
  assert.ok(!set.has('light.vecchia'), 'R1 disabilitata')
  assert.ok(!set.has('light.nascosta'), 'R2 nascosta')
  assert.ok(!set.has('sensor.radar_rssi'), 'R3 diagnostica')
  assert.ok(!set.has('switch.switch_rete_porta_1'), 'R4 piattaforma di rete')
  assert.ok(!set.has('switch.rele_camera_uscita'), 'R5b switch su dispositivo con luce')
  assert.ok(!set.has('sensor.presa_lavatrice_tensione'), 'R5d tensione non utile di default')
  assert.ok(!set.has('button.riavvia_router') && !set.has('update.lampada_arco_firmware'), 'R5e')
  assert.ok(!set.has('automation.luci_sera'), 'automazioni elencate a parte')
})

test('inventario: privacy di default esclude posizione, telecamere e app mobile', () => {
  const { inv, set } = ids()
  for (const id of ['device_tracker.telefono', 'sensor.telefono_batteria', 'sensor.telefono_posizione', 'camera.ingresso', 'binary_sensor.ingresso_movimento']) {
    assert.ok(!set.has(id), `${id} non deve uscire senza consenso`)
  }
  assert.ok(inv.stats.excludedPrivacy.telecamere >= 2)
  assert.ok(inv.stats.excludedPrivacy.appMobile >= 2)
  const withAll = ids(ALL).set
  assert.ok(withAll.has('binary_sensor.ingresso_movimento'), 'col consenso le telecamere rientrano')
  assert.ok(withAll.has('camera.ingresso') === false, 'camera resta fuori per rilevanza (R5e)')
})

test('inventario: R6 forza le entità usate dalle automazioni', () => {
  const { inv, set } = ids(DEFAULT_CONSENTS, new Set(['sensor.presa_lavatrice_tensione']))
  assert.ok(set.has('sensor.presa_lavatrice_tensione'))
  assert.equal(inv.entities.find((e) => e.entity_id === 'sensor.presa_lavatrice_tensione')?.forced, true)
  assert.equal(inv.stats.forcedByAutomations, 1)
})

test('inventario: rendering deterministico anche con input in ordine diverso', () => {
  const reg = fakeRegistries()
  const states = fakeStates()
  const a = renderInventory(buildInventory({ registries: reg, states, consents: DEFAULT_CONSENTS, referenced: new Set() }), reg, DEFAULT_CONSENTS)
  const reg2 = { ...reg, entities: [...reg.entities].reverse(), devices: [...reg.devices].reverse(), areas: [...reg.areas].reverse(), floors: [...reg.floors].reverse() }
  const states2 = new Map([...states.entries()].reverse())
  const b = renderInventory(buildInventory({ registries: reg2, states: states2, consents: DEFAULT_CONSENTS, referenced: new Set() }), reg2, DEFAULT_CONSENTS)
  assert.equal(a, b)
  // Piano terra (livello 0) prima del primo piano, aree in ordine alfabetico
  assert.ok(a.indexOf('## Piano: Piano terra') < a.indexOf('## Piano: Primo piano'))
  assert.ok(a.indexOf('### Cucina') < a.indexOf('### Soggiorno'))
  assert.match(a, /- Dispositivo "Lampada Arco" \(Lumi L100\):\n {2}- light\.lampada_arco · Lampada arco/)
  assert.match(a, /automation\.luci_sera · "Luci sera" · id 1700000000001 · categoria Luci/)
  assert.match(a, /automation\.vecchia · "Vecchia" · id 1700000000002 · disattivata/)
})

test('inventario: niente stati, seriali, MAC o coordinate nel testo', () => {
  const reg = fakeRegistries()
  const text = renderInventory(buildInventory({ registries: reg, states: fakeStates(), consents: DEFAULT_CONSENTS, referenced: new Set() }), reg, DEFAULT_CONSENTS)
  for (const bad of ['SN-DA-NON-INVIARE', 'aa:bb:cc', '45.1', 'Ufficio', 'Via Finta', 'segreto', 'telefono']) {
    assert.ok(!text.includes(bad), `"${bad}" non deve comparire`)
  }
})

test('privacy: attributi ripuliti e persone solo casa/fuori', () => {
  const person = fakeStates().get('person.demo')!
  assert.deepEqual(sanitizeAttributes('person.demo', person.attributes, DEFAULT_CONSENTS), { friendly_name: 'Demo' })
  assert.equal(sanitizeState('person.demo', 'Ufficio', DEFAULT_CONSENTS), 'not_home')
  assert.equal(sanitizeState('person.demo', 'home', DEFAULT_CONSENTS), 'home')
  assert.equal(sanitizeState('person.demo', 'Ufficio', ALL), 'Ufficio')

  const zone = sanitizeAttributes('zone.home', { latitude: 1, longitude: 2, radius: 100, friendly_name: 'Casa' }, DEFAULT_CONSENTS)
  assert.deepEqual(zone, { friendly_name: 'Casa', radius: 100 })
  assert.ok('latitude' in sanitizeAttributes('zone.home', { latitude: 1 }, ALL))

  const cam = sanitizeAttributes('camera.x', { access_token: 'x', entity_picture: '/a', friendly_name: 'C', ip_address: '10.0.0.2', mac: 'aa:bb:cc:dd:ee:ff', api_key: 'k', fan_speed: 'alta', microphone: true }, ALL)
  assert.deepEqual(cam, { fan_speed: 'alta', friendly_name: 'C', microphone: true })

  assert.equal(scrubString('vai su http://10.0.0.2:8123/api?token=x e 192.168.1.1, mac AA:BB:CC:DD:EE:FF'), 'vai su [url rimosso] e [ip rimosso], mac [mac rimosso]')
})

test('R6: riferimenti estratti anche dai template', () => {
  const out = new Set<string>()
  collectEntityRefs(AUTOMATION_CONFIG, new Set(fakeStates().keys()), out)
  assert.deepEqual([...out].sort(), ['binary_sensor.radar_presenza', 'light.lampada_arco', 'sensor.presa_lavatrice_tensione'])
})

test('snapshot e prompt di sistema: stabili tra due chat sulla stessa casa', async () => {
  resetSnapshotCache()
  const ha = fakeHA()
  const s1 = await buildHomeSnapshot(ha, DEFAULT_CONSENTS)
  const s2 = await buildHomeSnapshot(ha, DEFAULT_CONSENTS)
  const p1 = JSON.stringify(buildSystemPrompt(s1))
  assert.equal(p1, JSON.stringify(buildSystemPrompt(s2)))
  // R6 dalla config dell'automazione: la tensione entra perché usata nel template
  assert.match(s1.inventoryText, /sensor\.presa_lavatrice_tensione .*\[usata da automazioni\]/)
  const blocks = buildSystemPrompt(s1)
  assert.equal(blocks.length, 2)
  assert.deepEqual(blocks[1]!.cache_control, { type: 'ephemeral', ttl: '1h' })
  assert.ok(!/Adesso:|\d{2}\/\d{2}\/\d{4}|ore \d{2}:\d{2}/.test(blocks[0]!.text + blocks[1]!.text), 'niente data/ora corrente nel prompt di sistema')
})
