import { test } from 'node:test'
import assert from 'node:assert/strict'
import { executeTool, toolDefinitions, toolLabel, CHAT_TOOLS } from '../src/claude/tools/registry.ts'
import { summarizeSeries, toSamples } from '../src/claude/tools/history.ts'
import { DEFAULT_CONSENTS, type Consents } from '../src/inventory/privacy.ts'
import type { ToolContext } from '../src/claude/tools/common.ts'
import { fakeHA, fakeRegistries } from './fakeHome.ts'
import { buildSystemPrompt } from '../src/claude/prompt.ts'
import { buildHomeSnapshot, resetSnapshotCache } from '../src/inventory/snapshot.ts'

const NOW = new Date('2026-10-14T10:00:00Z')

function ctx(consents: Consents = DEFAULT_CONSENTS, ha = fakeHA()): ToolContext & { ha: ReturnType<typeof fakeHA> } {
  return { ha, consents: () => consents, now: () => NOW }
}

async function run(name: string, input: unknown, c = ctx()) {
  const r = await executeTool(name, input, c)
  return { ...r, json: r.isError ? null : JSON.parse(r.content) }
}

test('definizioni dei tool: schema oggetto, streaming eager, nomi unici', () => {
  const defs = toolDefinitions()
  assert.equal(defs.length, CHAT_TOOLS.length)
  assert.equal(new Set(defs.map((d) => d.name)).size, defs.length)
  for (const d of defs) {
    assert.equal(d.input_schema.type, 'object', d.name)
    assert.equal(d.eager_input_streaming, true)
    assert.ok(!('$schema' in d.input_schema))
  }
  // Deterministiche: due chiamate producono gli stessi byte (il prefisso della cache dipende da qui)
  assert.equal(JSON.stringify(defs), JSON.stringify(toolDefinitions()))
})

test('input non valido o tool sconosciuto: is_error, nessuna chiamata a HA', async () => {
  const c = ctx()
  for (const [name, input] of [
    ['dettagli_entita', { entity_id: 'non valido' }],
    ['riepilogo_storico', { entity_ids: [] }],
    ['riepilogo_storico', { entity_ids: ['sensor.a'], ore: 99999 }],
    ['cerca_entita', { limite: 500 }],
    ['info_dispositivo', {}],
    ['spegni_tutto', {}],
  ] as const) {
    const r = await executeTool(name, input, c)
    assert.equal(r.isError, true, name)
  }
  assert.equal(c.ha.calls.length, 0)
})

test('cerca_entita: trova per area/alias e rispetta la privacy', async () => {
  const r = await run('cerca_entita', { testo: 'salotto' })
  const found = r.json.risultati.map((x: any) => x.entity_id)
  assert.ok(found.includes('light.lampada_arco'))
  const cam = await run('cerca_entita', { testo: 'ingresso' })
  assert.equal(cam.json.totale, 0, 'entità della videocamera escluse di default')
  const camOk = await run('cerca_entita', { testo: 'ingresso' }, ctx({ posizione: false, telecamere: true, appMobile: false }))
  assert.ok(camOk.json.totale >= 1)
  const ip = await run('cerca_entita', { testo: 'router' })
  const router = ip.json.risultati.find((x: any) => x.entity_id === 'sensor.router_ip')
  assert.equal(router.stato, '[ip rimosso]')
  const persona = await run('cerca_entita', { dominio: 'person' })
  assert.equal(persona.json.risultati[0].stato, 'not_home')
})

test('dettagli_entita: attributi puliti, riferimenti, privacy', async () => {
  const r = await run('dettagli_entita', { entity_id: 'light.lampada_arco' })
  assert.equal(r.json.stato, 'on')
  assert.ok(!('entity_picture' in r.json.attributi))
  assert.deepEqual(r.json.usata_da, { automazioni: ['automation.luci_sera'] })
  assert.equal(r.json.ultimo_cambio, '2026-10-14 10:00:00', 'orario nel fuso della casa (Europe/Rome)')

  const blocked = await executeTool('dettagli_entita', { entity_id: 'camera.ingresso' }, ctx())
  assert.equal(blocked.isError, true)
  assert.match(blocked.content, /privacy/)
  const missing = await executeTool('dettagli_entita', { entity_id: 'light.inesistente' }, ctx())
  assert.match(missing.content, /non esiste/)
})

test('riepilogo_storico: numerico e a stati, mai serie grezze', async () => {
  const c = ctx()
  const start = NOW.getTime() / 1000 - 24 * 3600
  c.ha.history['sensor.media_temperatura'] = [
    { s: '20', lu: start - 100 },
    { s: '22', lu: start + 6 * 3600 },
    { s: '18', lu: start + 12 * 3600 },
  ]
  c.ha.history['binary_sensor.radar_presenza'] = [
    { s: 'off', lu: start - 50 },
    { s: 'on', lu: start + 3600 },
    { s: 'off', lu: start + 2 * 3600 },
    { s: 'on', lu: start + 20 * 3600 },
  ]
  const r = await run('riepilogo_storico', { entity_ids: ['sensor.media_temperatura', 'binary_sensor.radar_presenza'], ore: 24 }, c)
  const t = r.json.entita['sensor.media_temperatura']
  assert.equal(t.tipo, 'numerico')
  assert.equal(t.min.valore, 18)
  assert.equal(t.max.valore, 22)
  assert.equal(t.media_nel_tempo, 19.5) // (6 h × 20 + 6 h × 22 + 12 h × 18) / 24 h
  assert.equal(t.fasce.length, 24)
  const p = r.json.entita['binary_sensor.radar_presenza']
  assert.equal(p.tipo, 'stati')
  assert.equal(p.cambi, 3)
  assert.deepEqual(p.ingressi_per_stato, { on: 2, off: 1 })
  assert.equal(p.ultimi_cambi.length, 3)
  const req = c.ha.calls.find((x) => x.type === 'history/history_during_period')!
  assert.equal(req.minimal_response, true)
  assert.equal(req.no_attributes, true)
})

test('riepilogo_storico: le persone restano casa/fuori anche nello storico', () => {
  const samples = toSamples([{ s: 'home', lu: 0 }, { s: 'Ufficio', lu: 3600 }]).map((x) => ({ t: x.t, s: x.s === 'Ufficio' ? 'not_home' : x.s }))
  const s = summarizeSeries(samples, { startMs: 0, endMs: 7_200_000, tz: 'Europe/Rome' })
  assert.deepEqual(Object.keys(s.tempo_per_stato as object).sort(), ['home', 'not_home'])
})

test('leggi_automazione: config ripulita, stati delle entità usate, tracce', async () => {
  const r = await run('leggi_automazione', { automazione: '1700000000001' })
  assert.equal(r.json.entity_id, 'automation.luci_sera')
  const cfg = JSON.stringify(r.json.configurazione)
  assert.ok(!cfg.includes('segretissimo-webhook'))
  assert.ok(!cfg.includes('token=abc'))
  assert.ok(cfg.includes('[nascosto]'))
  assert.deepEqual(Object.keys(r.json.stato_entita_usate).sort(), ['binary_sensor.radar_presenza', 'light.lampada_arco', 'sensor.presa_lavatrice_tensione'])
  assert.equal(r.json.ultime_esecuzioni.length, 2)
  assert.equal(r.json.ultime_esecuzioni[0].esito, 'failed_conditions', 'la più recente per prima')
  const missing = await executeTool('leggi_automazione', { automazione: 'automation.nessuna' }, ctx())
  assert.equal(missing.isError, true)
})

test('elenca_automazioni e catalogo_trigger', async () => {
  const all = await run('elenca_automazioni', {})
  assert.equal(all.json.totale, 2)
  assert.equal(all.json.automazioni[0].categoria, 'Luci')
  const off = await run('elenca_automazioni', { solo_disattivate: true })
  assert.deepEqual(off.json.automazioni.map((a: any) => a.entity_id), ['automation.vecchia'])
  const byEntity = await run('elenca_automazioni', { entity_id: 'light.lampada_arco' })
  assert.deepEqual(byEntity.json.automazioni.map((a: any) => a.entity_id), ['automation.luci_sera'])

  const names = await run('catalogo_trigger', {})
  assert.deepEqual(names.json.trigger, ['light.turned_on', 'numeric_state', 'state', 'sun', 'time', 'webhook'])
  const light = await run('catalogo_trigger', { filtro: 'light' })
  assert.equal(light.json.trigger['light.turned_on'].campi.behavior.tipo, 'select')
})

test('info_dispositivo: niente seriali o MAC, documentazione e trigger', async () => {
  const r = await run('info_dispositivo', { entity_id: 'light.lampada_arco' })
  const text = JSON.stringify(r.json)
  assert.ok(!text.includes('SN-DA-NON-INVIARE') && !text.includes('aa:bb:cc'))
  assert.equal(r.json.integrazione, 'lumi')
  assert.equal(r.json.manifest.documentazione, 'https://www.home-assistant.io/integrations/lumi')
  assert.equal(r.json.trigger_di_dispositivo[0].tipo, 'turned_on')
  const cam = await executeTool('info_dispositivo', { device_id: 'dev_cam' }, ctx())
  assert.equal(cam.isError, true)
})

test('etichette dei tool per i chip', () => {
  assert.equal(toolLabel('cerca_entita', { testo: 'luce', area: 'cucina' }), 'Cerco "luce" in cucina')
  assert.equal(toolLabel('sconosciuto', {}), 'sconosciuto')
})

test('elenca_notifiche: telefoni col nome del dispositivo, Alexa, interfaccia di HA; mai notify.notify', async () => {
  const reg = fakeRegistries()
  reg.devices = reg.devices.map((d) => (d.id === 'dev_telefono' ? { ...d, config_entries: ['ce_app'] } : d))
  reg.configEntryDomain = { ...reg.configEntryDomain, ce_app: 'mobile_app' }
  const r = await run('elenca_notifiche', {}, ctx(DEFAULT_CONSENTS, fakeHA({ registries: reg })))
  assert.deepEqual(r.json.telefoni_e_tablet, [
    { azione: 'notify.mobile_app_tablet_vecchio', tipo: 'app Home Assistant (telefono o tablet)' },
    { azione: 'notify.mobile_app_telefono_di_demo', dispositivo: 'Telefono di Demo', tipo: 'app Home Assistant (telefono o tablet)' },
  ])
  assert.deepEqual(r.json.altri_servizi, [
    { azione: 'notify.alexa_media_eco_cucina', tipo: 'Alexa (annuncio o notifica)' },
    { azione: 'notify.mobile_app', tipo: 'servizio di notifica' },
  ])
  assert.equal(r.json.interfaccia_home_assistant.azione, 'persistent_notification.create')
  assert.ok(!JSON.stringify(r.json.telefoni_e_tablet.concat(r.json.altri_servizi)).includes('"notify.notify"'))
  assert.match(r.json.nota, /Chiedi all'utente/)

  // La regola nel prompt della chat: chiedere il dispositivo prima della bozza.
  resetSnapshotCache()
  const prompt = buildSystemPrompt(await buildHomeSnapshot(fakeHA(), DEFAULT_CONSENTS))[0]!.text
  assert.match(prompt, /Notifiche: prima di proporre un'automazione che avvisa qualcuno, chiedi all'utente su quale dispositivo/)
})
