import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { buildCatalog } from '../src/devices/catalog.ts'
import { cardSlug, KbStore, type Card } from '../src/devices/kb.ts'
import { DevicesError, DevicesService } from '../src/devices/service.ts'
import { checkCard, trustedDomains, urlKey, type StudySubject } from '../src/devices/study.ts'
import { messageCost } from '../src/claude/pricing.ts'
import { UsageLedger } from '../src/claude/usage.ts'
import { buildSystemPrompt } from '../src/claude/prompt.ts'
import { executeTool } from '../src/claude/tools/registry.ts'
import type { ToolContext } from '../src/claude/tools/common.ts'
import { buildHomeSnapshot, resetSnapshotCache } from '../src/inventory/snapshot.ts'
import { DEFAULT_CONSENTS } from '../src/inventory/privacy.ts'
import { SettingsStore } from '../src/store/settings.ts'
import { DEFAULT_OPTIONS } from '../src/options.ts'
import { readJsonl } from '../src/store/atomic.ts'
import { devicesHA, devicesRegistries, devicesStates, MANIFESTS, SECRET_NAMES } from './fakeDevices.ts'
import { fakeStream, msg, text, thinking, toolUse } from './fakeClaude.ts'

type Json = Record<string, any>

const NOW = new Date('2026-10-15T09:00:00Z')
const FP2 = 'aqara|presence sensor fp2'
const PM2 = 'shelly|2pm gen4'
const HUB = 'switchbot|hub 2'
const A = 'https://community.home-assistant.io/t/aqara-fp2-esperienze/123'
const B = 'https://www.aqara.com/en/product/presence-sensor-fp2'
const DOC = 'https://www.home-assistant.io/integrations/homekit_controller'

const manifests = () => new Map(Object.entries(MANIFESTS).map(([d, m]) => [d, { name: m.name, iotClass: m.iot_class, documentation: m.documentation }]))

const search = (id: string, query: string) => ({ type: 'server_tool_use', id, name: 'web_search', input: { query }, caller: { type: 'direct' } })
const searchResult = (id: string, urls: string[]) => ({
  type: 'web_search_tool_result',
  tool_use_id: id,
  content: urls.map((url) => ({ type: 'web_search_result', url, title: `Pagina ${url.length}`, page_age: null, encrypted_content: 'cifrato' })),
})
const fetchUse = (id: string, url: string) => ({ type: 'server_tool_use', id, name: 'web_fetch', input: { url }, caller: { type: 'direct' } })
const fetchResult = (id: string, url: string) => ({
  type: 'web_fetch_tool_result',
  tool_use_id: id,
  content: { type: 'web_fetch_result', url, retrieved_at: null, content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'testo' }, title: 'Discussione FP2', citations: null } },
})

function card(fonti: Array<{ url: string; titolo: string }>): Json {
  return {
    nome_commerciale: 'Aqara Presence Sensor FP2',
    categoria: 'sensore di presenza mmWave a zone',
    sintesi: 'Rileva la presenza anche di persone ferme e divide la stanza in zone.',
    collegamento: 'Wi-Fi 2,4 GHz; integrazione locale HomeKit Controller consigliata, il cloud aggiunge latenza.',
    entita: [{ cosa: 'binary_sensor di occupazione per zona', significato: 'on finché qualcuno è nella zona' }],
    eventi: [],
    consigli: ['Nelle automazioni di spegnimento usa for: di almeno 1 minuto.'],
    limiti: ['Solo Wi-Fi a 2,4 GHz.'],
    fonti,
  }
}

const opus = (content: Json[], stop: string, searches = 0) =>
  msg(content, stop, {
    model: 'claude-opus-5-5',
    usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null, iterations: null, server_tool_use: { web_search_requests: searches, web_fetch_requests: 0 } },
  })

async function setup(steps: Parameters<typeof fakeStream>[0] = [], extra: Partial<ConstructorParameters<typeof DevicesService>[0]> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'assistente-dispositivi-'))
  const kb = new KbStore(dir)
  await kb.load()
  const settings = new SettingsStore(dir)
  await settings.load()
  const usage = new UsageLedger(dir, () => 'Europe/Rome', () => NOW)
  const stream = fakeStream(steps)
  const ha = devicesHA()
  const service = new DevicesService({ kb, ha, settings, usage, options: { ...DEFAULT_OPTIONS, anthropicApiKey: 'x' }, stream, now: () => NOW, ...extra })
  return { dir, kb, usage, stream, ha, service }
}

test('catalogo: un modello per voce anche con più integrazioni, locale prima; esclusi disabilitati, servizi, senza modello e telecamere', () => {
  const entries = buildCatalog({ registries: devicesRegistries(), states: devicesStates(), consents: DEFAULT_CONSENTS, manifests: manifests() })
  assert.deepEqual(entries.map((e) => e.key).sort(), [FP2, PM2, HUB])

  const fp = entries.find((e) => e.key === FP2)!
  assert.deepEqual(fp.integrations.map((i) => i.domain), ['homekit_controller', 'aqara_cloud'])
  assert.equal(fp.devices.length, 2)
  assert.equal(fp.model, 'Presence Sensor FP2')
  assert.equal(fp.manufacturer, 'Aqara')
  assert.deepEqual(fp.modelIds, ['PS-S02D'])
  assert.deepEqual(fp.firmware, ['1.2.7'])
  assert.deepEqual(fp.entityKinds, { 'binary_sensor/occupancy': 3, 'sensor/illuminance': 1 })

  // Il codice modello di SmartThings coincide con il model_id dell'integrazione Shelly.
  const pm = entries.find((e) => e.key === PM2)!
  assert.deepEqual(pm.integrations.map((i) => i.domain), ['shelly', 'smartthings'])
  assert.equal(pm.model, 'Shelly 2PM Gen4')
  assert.deepEqual(pm.modelIds, ['S4SW-002P16EU'])

  // "Woan Technology" è SwitchBot, e "SwitchBot Hub 2" è lo stesso modello di "Hub 2".
  const hub = entries.find((e) => e.key === HUB)!
  assert.deepEqual(hub.integrations.map((i) => i.domain), ['switchbot', 'switchbot_cloud'])
  assert.equal(hub.devices.length, 2)
})

test('domini fidati, chiavi degli URL e prezzo delle ricerche', () => {
  const subject: StudySubject = { manufacturer: 'Wiim Audio', model: 'Pro', modelIds: [], firmware: [], integrations: [{ domain: 'linkplay', name: null, iotClass: 'local_polling', documentation: 'https://docs.esempio.org/linkplay' }], entityKinds: {}, triggers: [] }
  const d = trustedDomains(subject)
  for (const x of ['home-assistant.io', 'github.com', 'zigbee2mqtt.io', 'wiim.com', 'docs.esempio.org']) assert.ok(d.includes(x), x)
  assert.ok(trustedDomains({ ...subject, manufacturer: 'Shelly', integrations: [] }).includes('shelly.cloud'))

  assert.equal(urlKey('https://www.Esempio.com/a/b/#x'), urlKey('http://esempio.com/a/b'))
  assert.notEqual(urlKey('https://esempio.com/a?p=1'), urlKey('https://esempio.com/a?p=2'))
  assert.equal(cardSlug(FP2), 'aqara__presence-sensor-fp2')

  const u = messageCost({ model: 'claude-opus-5-5', usage: { input_tokens: 0, output_tokens: 0, server_tool_use: { web_search_requests: 3 } } })
  assert.equal(u.searches, 3)
  assert.ok(Math.abs(u.costUsd - 0.03) < 1e-9)

  const seen = new Map([[urlKey(A)!, { url: A, title: 'A' }]])
  const bad = checkCard(card([{ url: 'https://inventato.example.com/x', titolo: 'X' }]), seen, new Set())
  assert.equal(bad.ok, false)
  const ok = checkCard(card([{ url: A + '/', titolo: 'A' }, { url: A, titolo: 'doppione' }]), seen, new Set([urlKey(A)!]))
  assert.ok(ok.ok)
  if (ok.ok) assert.deepEqual(ok.content.fonti, [{ url: A, titolo: 'A', aperta: true }])
})

test('studio: domini fidati, ripresa dopo pause_turn, fonti verificate con una correzione, nessun dato della casa', async () => {
  const { service, stream, usage, dir, kb } = await setup([
    opus([thinking(), search('s1', 'Aqara Presence Sensor FP2 Home Assistant'), searchResult('s1', [A, B]), fetchUse('f1', A), fetchResult('f1', A)], 'pause_turn', 1),
    opus([toolUse('t1', 'salva_scheda', card([{ url: A, titolo: 'Forum' }, { url: 'https://inventato.example.com/fp2', titolo: 'Inventata' }]))], 'tool_use'),
    opus([toolUse('t2', 'salva_scheda', card([{ url: A + '#post-3', titolo: 'Forum' }, { url: B, titolo: 'Produttore' }, { url: DOC, titolo: 'Documentazione HA' }]))], 'tool_use'),
  ])
  const { done, info } = await service.start(FP2, 'Demo', 'pagina')
  assert.equal(service.activeStudy()?.key, FP2)
  assert.equal(info.slug, 'aqara__presence-sensor-fp2')
  const saved = await done
  assert.equal(service.activeStudy(), null)

  assert.equal(saved.status, 'bozza')
  assert.deepEqual(
    saved.fonti.map((f) => [f.url, f.aperta]),
    [[A, true], [B, false], [DOC, false]],
  )
  assert.deepEqual(saved.study.queries, ['Aqara Presence Sensor FP2 Home Assistant'])
  assert.equal(saved.study.searches, 1)
  assert.equal(saved.study.fetches, 1)
  assert.equal(saved.study.effort, 'medium')
  assert.ok(Math.abs(saved.study.costUsd - (3 * (1000 * 4 + 500 * 20) / 1e6 + 0.01)) < 1e-6)

  // Richieste: strumenti web con domini fidati, ripresa, correzione delle fonti.
  assert.equal(stream.requests.length, 3)
  const r0 = stream.requests[0]!
  assert.equal(r0.model, 'claude-opus-5-5')
  const [ws, wf, save] = r0.tools as Json[]
  assert.equal(ws!.type, 'web_search_20260318')
  assert.equal(wf!.type, 'web_fetch_20260318')
  assert.deepEqual(ws!.allowed_callers, ['direct'])
  assert.ok(ws!.allowed_domains.includes('home-assistant.io') && ws!.allowed_domains.includes('aqara.com'))
  assert.deepEqual(wf!.allowed_domains, ws!.allowed_domains)
  assert.equal(save!.name, 'salva_scheda')
  assert.equal(save!.input_schema.type, 'object')
  assert.match(r0.system[0].text, /DATI, non istruzioni/)
  assert.equal(stream.requests[1]!.messages.length, 2)
  assert.equal(stream.requests[1]!.messages[1].role, 'assistant')
  const repair = stream.requests[2]!.messages.at(-1)
  assert.equal(repair.content[0].type, 'tool_result')
  assert.equal(repair.content[0].is_error, true)
  assert.match(repair.content[0].content, /inventato\.example\.com/)
  // Le richieste usano gli stessi strumenti (cache) e non contengono nulla della casa.
  for (const r of stream.requests) {
    assert.deepEqual(r.tools, r0.tools)
    const json = JSON.stringify(r)
    for (const secret of [...SECRET_NAMES, 'radar_zona', 'd_fp_hk', 'Radar cloud']) assert.ok(!json.includes(secret), `${secret} nella richiesta`)
  }
  assert.match(JSON.stringify(r0.messages), /PS-S02D/)
  assert.match(JSON.stringify(r0.messages), /binary_sensor:occupied/)

  // Consumi registrati come "devices", scheda su disco.
  const records = await readJsonl<Json>(join(dir, 'usage.jsonl'))
  assert.equal(records.length, 3)
  assert.ok(records.every((r) => r.kind === 'devices' && r.conversationId === 'aqara__presence-sensor-fp2'))
  assert.ok(usage.monthSpent() > 0.01)
  const reloaded = new KbStore(dir)
  await reloaded.load()
  assert.equal(reloaded.get(FP2)?.nome_commerciale, 'Aqara Presence Sensor FP2')
  assert.equal(kb.list().length, 1)

  // Approvazione ed eliminazione dalla pagina.
  const approved = await service.approve(cardSlug(FP2), 'Demo')
  assert.equal(approved.status, 'approvata')
  assert.equal(approved.approved?.by, 'Demo')
  const overview = await service.overview()
  assert.equal(overview.entries.find((e) => e.key === FP2)?.card?.status, 'approvata')
  await service.remove(cardSlug(FP2))
  assert.equal(kb.get(FP2), undefined)
})

test('studio: sollecito se manca la scheda, poi errore; uno alla volta; annullabile; budget', async () => {
  const { service } = await setup([opus([text('Ho finito.')], 'end_turn'), opus([text('Fatto.')], 'end_turn')])
  const { done } = await service.start(PM2, 'Demo', 'pagina')
  await assert.rejects(done, (e: DevicesError) => e.code === 'nessuna_scheda')
  const ov = await service.overview()
  assert.match(ov.entries.find((e) => e.key === PM2)!.failure!.message, /senza salvare/)

  const waiting = (_p: unknown, signal: AbortSignal) =>
    new Promise<never>((_r, reject) => signal.addEventListener('abort', () => reject(new Anthropic.APIUserAbortError())))
  const s2 = await setup([waiting])
  const first = await s2.service.start(HUB, 'Demo', 'pagina')
  await assert.rejects(s2.service.start(FP2, 'Demo', 'pagina'), (e: DevicesError) => e.status === 409)
  const again = await s2.service.start(HUB, 'Demo', 'pagina')
  assert.equal(again.joined, true)
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(s2.service.stop(), true)
  await assert.rejects(first.done, (e: DevicesError) => e.code === 'annullato')
  assert.equal(s2.service.activeStudy(), null)
  await assert.rejects(s2.service.start('shelly|inesistente', 'Demo', 'pagina'), (e: DevicesError) => e.status === 404)

  const s3 = await setup()
  await s3.usage.record({ kind: 'chat', conversationId: 'c', model: 'm', input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 99 })
  await assert.rejects(s3.service.start(FP2, 'Demo', 'pagina'), (e: DevicesError) => e.status === 429)
})

test('chat: indice delle schede nel prompt, leggi_scheda_dispositivo, studia_dispositivo con tetto per conversazione', async () => {
  let studies = 0
  const fakeStudy = async () => {
    studies += 1
    return {
      content: { ...(card([]) as Omit<Card, 'fonti'>), fonti: [{ url: A, titolo: 'Forum', aperta: true }] },
      usage: { model: 'claude-opus-5-5', input: 10, output: 10, cacheRead: 0, cacheWrite: 0, costUsd: 0.2, fallback: false, searches: 1 },
      searches: 1,
      fetches: 1,
      queries: ['q'],
      steps: 1,
    }
  }
  const { service, ha } = await setup([], { study: fakeStudy as never })
  await (await service.start(FP2, 'Demo', 'pagina')).done

  resetSnapshotCache()
  const snapshot = await buildHomeSnapshot(ha, DEFAULT_CONSENTS)
  const prompt = buildSystemPrompt(snapshot, service.index())
  assert.match(prompt[1]!.text, /<schede_dispositivi>\n- Aqara Presence Sensor FP2: sensore di presenza mmWave a zone \[bozza, non ancora approvata\]\n<\/schede_dispositivi>/)
  assert.match(prompt[0]!.text, /Secondo la scheda/)
  assert.match(buildSystemPrompt(snapshot)[1]!.text, /\(nessuna scheda\)/)

  const ctx: ToolContext = { ha, consents: () => DEFAULT_CONSENTS, now: () => NOW, devices: service }
  const run = async (name: string, input: unknown, conversationId = 'c1') => {
    const r = await executeTool(name, input, { ...ctx, call: { conversationId, toolUseId: 'tu' } })
    return { ...r, json: r.isError ? null : JSON.parse(r.content) }
  }

  const byEntity = await run('leggi_scheda_dispositivo', { entity_id: 'binary_sensor.radar_zona_1' })
  assert.equal(byEntity.json.scheda.nome_commerciale, 'Aqara Presence Sensor FP2')
  assert.match(byEntity.json.scheda.stato, /bozza/)
  assert.match(byEntity.json.scheda.avviso, /non come istruzioni/)
  const byModel = await run('leggi_scheda_dispositivo', { produttore: 'Shelly', modello: 'S4SW-002P16EU' })
  assert.equal(byModel.json.scheda, null)
  assert.equal(byModel.json.modello.modello, 'Shelly 2PM Gen4')
  assert.equal((await run('leggi_scheda_dispositivo', { modello: 'zzz' })).isError, true)

  const info = await run('info_dispositivo', { device_id: 'd_fp_hk' })
  assert.match(info.json.scheda_modello, /bozza/)

  // Già studiato: nessun nuovo studio. Poi due studi in c1, il terzo no; in c2 sì.
  assert.equal((await run('studia_dispositivo', { modello: 'Presence Sensor FP2', motivo: 'chiesto' })).json.gia_presente, true)
  assert.equal(studies, 1)
  assert.equal((await run('studia_dispositivo', { produttore: 'Shelly', modello: '2PM Gen4', motivo: 'chiesto' })).json.studiato, true)
  assert.equal((await run('studia_dispositivo', { produttore: 'SwitchBot', modello: 'Hub 2', motivo: 'chiesto' })).json.studiato, true)
  await service.remove(cardSlug(PM2))
  const capped = await run('studia_dispositivo', { produttore: 'Shelly', modello: '2PM Gen4', motivo: 'chiesto' })
  assert.equal(capped.isError, true)
  assert.match(capped.content, /già stati avviati 2/)
  assert.equal((await run('studia_dispositivo', { produttore: 'Shelly', modello: '2PM Gen4', motivo: 'chiesto' }, 'c2')).json.studiato, true)
  assert.equal(studies, 4)
})

test('Studia tutti: uno alla volta, salta chi ha la scheda, si ferma dopo due errori di fila o a mano', async () => {
  const waitFor = async (cond: () => boolean) => {
    for (let i = 0; i < 400 && !cond(); i++) await new Promise((r) => setTimeout(r, 5))
    assert.ok(cond(), 'condizione non raggiunta')
  }
  const result = (costUsd = 0.2) => ({
    content: { ...(card([]) as Omit<Card, 'fonti'>), fonti: [{ url: A, titolo: 'Forum', aperta: true }] },
    usage: { model: 'claude-opus-5-5', input: 10, output: 10, cacheRead: 0, cacheWrite: 0, costUsd, fallback: false, searches: 1 },
    searches: 1,
    fetches: 1,
    queries: ['q'],
    steps: 1,
  })
  const seen: string[] = []
  let running = 0
  const fails = new Set([PM2])
  const fakeStudy = async (req: { subject: StudySubject }) => {
    running += 1
    assert.equal(running, 1, 'mai due studi insieme')
    seen.push(req.subject.model)
    await new Promise((r) => setTimeout(r, 5))
    running -= 1
    const key = { 'Shelly 2PM Gen4': PM2, 'Presence Sensor FP2': FP2 }[req.subject.model] ?? HUB
    if (fails.has(key)) throw new Error('errore simulato')
    return result()
  }
  const { service, kb } = await setup([], { study: fakeStudy as never })
  const batch = await service.startBatch([FP2, PM2, HUB, 'shelly|inesistente', FP2], 'Demo')
  assert.equal(batch.total, 3)
  await assert.rejects(service.startBatch([HUB], 'Demo'), (e: DevicesError) => e.code === 'gruppo_in_corso')
  await waitFor(() => !batch.running)
  assert.deepEqual([batch.done, batch.failed, batch.pending.length, batch.stopped], [2, 1, 0, undefined])
  assert.equal(seen.length, 3)
  assert.ok(kb.get(FP2) && kb.get(HUB) && !kb.get(PM2))
  assert.equal((await service.overview()).batch?.done, 2)

  // Di nuovo sugli stessi modelli: resta solo quello senza scheda.
  const again = await service.startBatch([FP2, PM2, HUB], 'Demo')
  assert.equal(again.total, 1)
  await waitFor(() => !again.running)
  fails.clear()
  await kb.remove(FP2)
  await kb.remove(HUB)
  await assert.rejects(service.startBatch([HUB, FP2, PM2].filter((k) => kb.get(k)), 'Demo'), (e: DevicesError) => e.code === 'niente_da_studiare' || e.status === 400)

  // Errori di fila: la coda si ferma.
  fails.add(FP2).add(PM2).add(HUB)
  const failing = await service.startBatch([FP2, PM2, HUB], 'Demo')
  await waitFor(() => !failing.running)
  assert.deepEqual([failing.done, failing.failed, failing.pending.length], [0, 2, 1])
  assert.match(failing.stopped!, /2 studi di fila non riusciti/)

  // Ferma: interrompe lo studio in corso e svuota la coda.
  const slow = async (_req: unknown, deps: { signal: AbortSignal }) =>
    new Promise<never>((_r, reject) => {
      if (deps.signal.aborted) reject(new Error('annullato'))
      deps.signal.addEventListener('abort', () => reject(new Error('annullato')))
    })
  const s2 = await setup([], { study: slow as never })
  const b2 = await s2.service.startBatch([FP2, PM2, HUB], 'Demo')
  await waitFor(() => s2.service.activeStudy() !== null)
  assert.equal(s2.service.stop(), true)
  await waitFor(() => b2.finishedAt !== undefined)
  assert.deepEqual([b2.done, b2.failed, b2.pending.length, b2.stopped], [0, 0, 2, 'Fermato a mano.'])
  assert.equal(s2.service.activeStudy(), null)
})
