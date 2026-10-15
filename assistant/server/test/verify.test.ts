import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkTimePattern, describePattern, resolvePattern } from '../src/verify/timepattern.ts'
import { replacement, SimilarityIndex } from '../src/verify/similar.ts'
import { runDynamicRules } from '../src/verify/dynamic.ts'
import { applyFixes, FixError } from '../src/verify/fixes.ts'
import { splitConcatenated } from '../src/verify/rules.ts'
import { VerifyService, VerifyError } from '../src/verify/service.ts'
import { VerifyStore, type VerifyRun } from '../src/verify/store.ts'
import { DraftService } from '../src/drafts/service.ts'
import { DraftStore } from '../src/drafts/store.ts'
import { ConversationStore } from '../src/chat/store.ts'
import { UsageLedger } from '../src/claude/usage.ts'
import { SettingsStore } from '../src/store/settings.ts'
import { DEFAULT_OPTIONS } from '../src/options.ts'
import type { ActivityEvent } from '../src/suggest/types.ts'
import { fakeStream, msg, text, thinking } from './fakeClaude.ts'
import { VNOW, verifyHome } from './fakeVerify.ts'

test('time_pattern a parole: "5" è il minuto 5, "/5" ogni 5 minuti; il nome suggerisce la correzione', () => {
  assert.equal(describePattern(resolvePattern({ minutes: '5' })!), "una volta all'ora, alle xx:05:00")
  assert.equal(describePattern(resolvePattern({ minutes: '/5' })!), 'ogni 5 minuti')
  assert.equal(describePattern(resolvePattern({ hours: '1' })!), 'una volta al giorno, alle 01:00:00')
  assert.equal(describePattern(resolvePattern({ seconds: '10' })!), 'una volta al minuto, al secondo 10')

  const byAlias = checkTimePattern({ trigger: 'time_pattern', hours: '1' }, '5 min lavatrice')!
  assert.equal(byAlias.severity, 'avviso')
  assert.deepEqual(byAlias.pattern, { minutes: '/5' })
  assert.equal(byAlias.certain, false, 'unità diversa da quella scritta: da confermare')
  const byId = checkTimePattern({ trigger: 'time_pattern', minutes: '5', seconds: '10', id: '5min' }, 'Luci')!
  assert.deepEqual(byId.pattern, { minutes: '/5', seconds: '10' }, 'il secondo esatto resta')
  assert.equal(byId.certain, true)
  const plain = checkTimePattern({ trigger: 'time_pattern', minutes: '20' }, 'Cibo off')!
  assert.equal(plain.severity, 'info')
  assert.equal(plain.label, 'Ogni 20 minuti (minutes: "/20")')
  assert.equal(checkTimePattern({ trigger: 'time_pattern', minutes: '/15', id: 'controllo' }, 'Pompa'), null)
  assert.equal(checkTimePattern({ trigger: 'time_pattern', minutes: '*' }, 'Energia minuto per minuto'), null)
  assert.equal(checkTimePattern({ trigger: 'time_pattern', seconds: '*' }, 'x')!.title, 'Scatta ogni secondo')
  assert.equal(checkTimePattern({ trigger: 'time_pattern', seconds: '2' }, 'Corrente off')!.pattern, undefined, 'ogni 2 secondi sarebbe peggio')
})

test('somiglianze prudenti: stesse parole e stessi numeri, mai la persona o la zona sbagliata', () => {
  const sim = new SimilarityIndex([
    ['switch.shelly_uscita_0', 'Pompa giardino'],
    ['sensor.telefono_di_bea_batteria', 'Batteria telefono Bea'],
    ['binary_sensor.radar_zona_1', 'Zona 1'],
    ['remote.camera_demo_2', 'remote.camera_demo_2'],
  ])
  const pump = replacement(sim.similar('switch.pompa_giardino'))!
  assert.deepEqual([pump.to, pump.certain], ['switch.shelly_uscita_0', true])
  assert.equal(sim.similar('sensor.telefono_di_ugo_batteria').length, 0, 'un altro nome di persona non va bene')
  assert.equal(sim.similar('binary_sensor.radar_zona_6').length, 0, 'zona 6 ≠ zona 1')
  assert.equal(replacement(sim.similar('remote.camera_demo'))!.to, 'remote.camera_demo_2')
  assert.deepEqual(sim.otherDomain('light.shelly_uscita_0'), ['switch.shelly_uscita_0'])
  assert.deepEqual(splitConcatenated('530', new Set(['5', '30'])), ['5', '30'])
  assert.equal(splitConcatenated('7', new Set(['5', '30'])), null)
})

test('regole dinamiche: oscillazioni, automazioni in conflitto, correzioni manuali', () => {
  const ev: ActivityEvent[] = []
  const t0 = Date.parse('2026-10-10T10:00:00Z')
  for (let d = 0; d < 3; d++) {
    for (let k = 0; k < 4; k++) {
      const t = t0 + d * 86_400_000 + k * 600_000
      ev.push({ t, e: 'light.a', s: 'on', c: 'automazione', by: 'automation.osc' }, { t: t + 20_000, e: 'light.a', s: 'off', c: 'automazione', by: 'automation.osc' })
    }
    const t = t0 + d * 86_400_000 + 5 * 3_600_000
    ev.push({ t, e: 'switch.b', s: 'on', c: 'automazione', by: 'automation.uno' }, { t: t + 30_000, e: 'switch.b', s: 'off', c: 'automazione', by: 'automation.due' })
    ev.push({ t: t + 3_600_000, e: 'cover.c', s: 'closed', c: 'automazione', by: 'automation.tapparella' }, { t: t + 3_660_000, e: 'cover.c', s: 'open', c: 'manuale', by: 'u' })
  }
  ev.sort((a, b) => a.t - b.t)
  const keys = new Map(['automation.osc', 'automation.uno', 'automation.due', 'automation.tapparella'].map((a) => [a, a]))
  const r = runDynamicRules(ev, { now: t0 + 4 * 86_400_000, days: 7, tz: 'Europe/Rome', keys, names: new Map() })
  const codes = r.findings.map((f) => `${f.code}:${f.automation}`).sort()
  assert.deepEqual(codes, ['correzioni_manuali:automation.tapparella', 'oscillazione:automation.osc', 'ping_pong:automation.uno'])
  assert.match(r.findings.find((f) => f.code === 'oscillazione')!.detail, /12 volte/)
  assert.equal(r.activity.get('light.a')!.changes, 24)
  assert.equal(r.actions.get('automation.osc'), 24)
})

test('correzioni meccaniche: entità (anche nei template), to: null, time_pattern, trigger id, sintassi', () => {
  const raw = {
    id: '1',
    alias: 'Prova',
    trigger: [
      { platform: 'state', entity_id: 'sensor.ble' },
      { platform: 'time_pattern', minutes: '5', id: '5' },
      { platform: 'state', entity_id: ['switch.vecchio', 'light.x'], to: 'on', id: '30' },
    ],
    condition: [{ condition: 'trigger', id: ['5', '530'] }],
    action: [{ service: 'switch.turn_on', target: { entity_id: 'switch.vecchio' } }, { service: 'notify.x', data: { message: "{{ states('switch.vecchio') }} e switch.vecchio_2" } }],
  }
  const out = applyFixes(raw, [
    { kind: 'sostituisci_entita', from: 'switch.vecchio', to: 'switch.nuovo', certain: true, label: '' },
    { kind: 'to_null', triggers: [0], certain: true, label: '' },
    { kind: 'time_pattern', trigger: 1, pattern: { minutes: '/5' }, certain: false, label: '' },
    { kind: 'trigger_id', from: '530', to: ['5', '30'], certain: true, label: '' },
    { kind: 'sintassi', certain: true, label: '' },
  ]) as Record<string, any>
  assert.equal(raw.trigger[0]!.platform, 'state', "l'originale non cambia")
  assert.deepEqual(out.triggers[0], { trigger: 'state', entity_id: 'sensor.ble', to: null })
  assert.deepEqual(out.triggers[1], { trigger: 'time_pattern', id: '5', minutes: '/5' })
  assert.deepEqual(out.triggers[2].entity_id, ['switch.nuovo', 'light.x'])
  assert.deepEqual(out.conditions[0].id, ['5', '30'])
  assert.equal(out.actions[0].action, 'switch.turn_on')
  assert.equal(out.actions[0].target.entity_id, 'switch.nuovo')
  assert.equal(out.actions[1].data.message, "{{ states('switch.nuovo') }} e switch.vecchio_2", 'solo la parola intera')
  assert.throws(() => applyFixes(raw, [{ kind: 'to_null', triggers: [1], certain: true, label: '' }]), FixError)
})

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'assistente-verify-'))
  const { ha, writer, states } = verifyHome()
  const conversations = new ConversationStore(dir)
  await conversations.load()
  const draftStore = new DraftStore(dir)
  await draftStore.load()
  const now = () => new Date(VNOW)
  const drafts = new DraftService({ store: draftStore, ha, writer, conversations, now, sleep: async () => undefined, pollMs: 1, pollTimeoutMs: 300 })
  const settings = new SettingsStore(dir)
  await settings.load()
  const usage = new UsageLedger(dir, () => 'Europe/Rome', now)
  await usage.load()
  const store = new VerifyStore(dir, now)
  await store.load()
  const chats: string[] = []
  const chat = { create: async () => ({ id: 'cprova12345' }), send: async (_id: string, t: string) => void chats.push(t) }
  const options = { ...DEFAULT_OPTIONS, anthropicApiKey: 'x', monthlyBudgetBlockUsd: 50 }
  return { dir, ha, writer, states, store, draftStore, drafts, settings, usage, chat, chats, options, now }
}

async function waitFor(store: VerifyStore, id: string, statuses: string[], service: VerifyService): Promise<VerifyRun> {
  for (let i = 0; i < 500; i++) {
    const r = store.get(id)!
    if (statuses.includes(r.status)) {
      await service.idle()
      return r
    }
    await new Promise((res) => setTimeout(res, 10))
  }
  throw new Error(`stato atteso ${statuses.join('/')}, trovato ${store.get(id)?.status}`)
}

test('Verifica: controllo rapido sui casi noti, correzione con un tap annullabile, problemi ignorati', async () => {
  const s = await setup()
  try {
    const stream = fakeStream([])
    const service = new VerifyService({ store: s.store, ha: s.ha, writer: s.writer, settings: s.settings, usage: s.usage, options: s.options, stream, count: async () => 1000, drafts: s.drafts, draftStore: s.draftStore, chat: s.chat, now: s.now })
    const started = await service.start('Demo', 7)
    await assert.rejects(service.start('Demo', 7), (e: VerifyError) => e.code === 'verifica_in_corso')
    const run = await waitFor(s.store, started.id, ['pronta', 'errore'], service)
    assert.equal(run.status, 'pronta', run.error)
    assert.equal(stream.requests.length, 0, 'il controllo rapido non chiama Claude')

    const auto = (alias: string) => run.reports.find((r) => r.alias === alias)!
    const codes = (alias: string) => run.findings.filter((f) => f.automation === auto(alias).entityId).map((f) => `${f.rule}:${f.code}:${f.severity}`).sort()
    const find = (alias: string, code: string) => run.findings.find((f) => f.automation === auto(alias).entityId && f.code === code)!

    // Modificabilità
    assert.equal(auto('Pompa giardino la sera').source, 'editor')
    assert.equal(auto('Umidità (package)').source, 'yaml')
    assert.equal(auto('Notifica porta (blueprint)').source, 'blueprint')

    // V1 + V10: riferimento rinominato con sostituzione certa; sintassi vecchia.
    assert.deepEqual(codes('Pompa giardino la sera'), ['V10:sintassi_vecchia:info', 'V1:entita_inesistente:errore'])
    const pump = find('Pompa giardino la sera', 'entita_inesistente')
    assert.deepEqual(pump.fix, { kind: 'sostituisci_entita', from: 'switch.pompa_giardino', to: 'switch.shelly_uscita_0', certain: true, label: 'Sostituisci switch.pompa_giardino con switch.shelly_uscita_0 ("Pompa giardino")' })
    // V6: sensore BLE senza `to`, migliaia di esecuzioni all'ora dalle tracce.
    const ble = find('Aggiorna stanza Demo', 'state_senza_to')
    assert.equal(ble.severity, 'avviso')
    assert.deepEqual(ble.fix, { kind: 'to_null', triggers: [0], certain: true, label: 'Aggiungi `to: null` al trigger 1' })
    assert.ok(auto('Aggiorna stanza Demo').traces.perHour! > 1000)
    // V5: id concatenato.
    assert.deepEqual(find('Assenza soggiorno', 'trigger_id_inesistente').fix, { kind: 'trigger_id', from: '530', to: ['5', '30'], certain: true, label: 'Usa gli id "5" e "30" al posto di "530"' })
    // V6: time_pattern; V8: presa riaccesa a mano; V9: esecuzione in errore.
    assert.deepEqual(codes('5 min lavatrice'), ['V6:time_pattern:avviso', 'V8:correzioni_manuali:avviso', 'V9:esecuzioni_in_errore:avviso'])
    assert.equal(find('Luce relè', 'time_pattern').fix!.certain, true)
    // V4 + V9: soglia mai raggiunta; attivazioni scartate (niente doppione "single con attesa").
    assert.deepEqual(codes('Lavatrice finita'), ['V4:soglia_mai_raggiunta:avviso', 'V9:esecuzioni_ignorate:avviso'])
    assert.match(find('Lavatrice finita', 'soglia_mai_raggiunta').detail, /al massimo a 29/)
    // V1 dispositivo sparito, V2 non caricata col motivo, V7 oscillazione, blueprint, YAML.
    assert.deepEqual(codes('Pulsante sparito'), ['V1:dispositivo_inesistente:errore'])
    assert.match(find('Rotta', 'non_caricata').detail, /valore non valido in triggers/)
    assert.equal(find('Luci controllo demo', 'oscillazione').severity, 'avviso')
    assert.deepEqual(codes('Notifica porta (blueprint)'), ['V1:entita_inesistente:avviso'])
    assert.ok(codes('Umidità (package)').includes('V3:entita_senza_dati:avviso'))
    assert.equal(run.findings[0]!.severity, 'errore', 'prima gli errori')
    assert.equal(run.stats!.automations, 11)
    assert.ok(run.estimate!.counted)
    assert.ok(run.dossiers[auto('Rotta').entityId]!.includes('"modificabile":true'))

    // Correzione con un tap: bozza di modifica → applica → Annulla ripristina.
    const id = auto('Pompa giardino la sera').entityId
    await assert.rejects(service.fix(run.id, auto('Umidità (package)').entityId, [find('Umidità (package)', 'sintassi_vecchia').id], 'Demo'), (e: VerifyError) => e.code === 'non_modificabile')
    await service.fix(run.id, id, [pump.id, find('Pompa giardino la sera', 'sintassi_vecchia').id], 'Demo')
    const draftId = s.store.get(run.id)!.fixes[id]!.draftId!
    const draft = s.draftStore.get(draftId)!
    assert.equal(draft.kind, 'update')
    assert.deepEqual(draft.verification, { runId: run.id, automation: id })
    assert.match(draft.yaml, /switch\.shelly_uscita_0/)
    assert.doesNotMatch(draft.yaml, /service:|platform:/)
    assert.ok(draft.diff!.some((l) => l.op === '-' && l.line.includes('switch.pompa_giardino')))
    await s.drafts.apply(draftId, { enabled: true, confirmCritical: false, by: 'Demo' })
    assert.match(JSON.stringify(s.writer.files.get('9000000000001')), /shelly_uscita_0/)
    await s.drafts.undo(draftId, { force: false, by: 'Demo' })
    assert.match(JSON.stringify(s.writer.files.get('9000000000001')), /switch\.pompa_giardino/)

    // Ignora: resta visibile ma esce dalla selezione per l'analisi.
    const rotta = find('Rotta', 'non_caricata')
    assert.ok(service.defaultSelection(s.store.get(run.id)!).includes(auto('Rotta').entityId))
    await service.ignore(run.id, rotta.id, 'Demo')
    const view = service.view(s.store.get(run.id)!)
    assert.equal(view.findings.find((f) => f.id === rotta.id)!.ignored, true)
    assert.ok(!view.defaultSelection.includes(auto('Rotta').entityId))
    assert.equal((view as Record<string, unknown>).dossiers, undefined, "i dossier non vanno all'interfaccia")
    await service.unignore(run.id, rotta.id)

    // Discuti in chat.
    await service.discuss(run.id, auto('Assenza soggiorno').entityId, 'Demo')
    assert.match(s.chats[0]!, /^Verifica: Assenza soggiorno/)
    assert.match(s.chats[0]!, /"530"/)
  } finally {
    await rm(s.dir, { recursive: true, force: true })
  }
})

test('Verifica: analisi approfondita a lotti, bozze di correzione con una riparazione', async () => {
  const s = await setup()
  try {
    const answer = (params: { messages: Array<{ content: unknown }> }) => {
      const ids = [...String(params.messages[0]!.content).matchAll(/"automazione":"(automation\.[a-z0-9_]+)"/g)].map((m) => m[1]!)
      return msg(
        [
          thinking(),
          text(
            JSON.stringify({
              valutazioni: ids.map((a) => {
                const yaml =
                  a === 'automation.assenza_soggiorno'
                    ? 'alias: Assenza soggiorno\ndescription: Spegne dopo 5 o 30 minuti\ntriggers:\n  - trigger: state\n    entity_id: binary_sensor.radar_presenza\n    to: "off"\n    for: { minutes: 5 }\n    id: "5"\n  - trigger: state\n    entity_id: binary_sensor.radar_presenza\n    to: "off"\n    for: { minutes: 30 }\n    id: "30"\nactions:\n  - action: light.turn_off\n    target:\n      entity_id: light.lampada_arco\nmode: restart\n'
                    : a === 'automation.5_min_lavatrice'
                      ? 'alias: 5 min lavatrice\ndescription: x\ntriggers:\n  - trigger: time_pattern\n    minutes: "/5"\nactions:\n  - action: switch.turn_off\n    target:\n      entity_id: switch.inventata\n'
                      : ''
                return { automazione: a, giudizio: yaml ? 'Problemi' : 'ok', sintesi: `Sintesi di ${a}`, problemi: [{ titolo: 'T', spiegazione: 'S', gravita: 'media' }], yaml_corretto: yaml, spiegazione_correzione: yaml ? 'Corregge.' : '' }
              }),
            }),
          ),
        ],
        'end_turn',
        { model: 'claude-opus-5-5', usage: { input_tokens: 5000, output_tokens: 3000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null, iterations: null } },
      )
    }
    const fixedYaml = 'alias: 5 min lavatrice\ndescription: x\ntriggers:\n  - trigger: time_pattern\n    minutes: "/5"\nactions:\n  - action: switch.turn_off\n    target:\n      entity_id: switch.presa_lavatrice\n'
    const stream = fakeStream([
      (p) => answer(p as never),
      (p) => answer(p as never),
      (p) => answer(p as never),
      () => msg([text(JSON.stringify({ correzioni: [{ automazione: 'automation.5_min_lavatrice', yaml: fixedYaml }] }))], 'end_turn', { model: 'claude-opus-5-5' }),
    ])
    const service = new VerifyService({ store: s.store, ha: s.ha, writer: s.writer, settings: s.settings, usage: s.usage, options: s.options, stream, count: null, drafts: s.drafts, draftStore: s.draftStore, chat: s.chat, now: s.now })
    const started = await service.start('Demo', 7)
    const run = await waitFor(s.store, started.id, ['pronta', 'errore'], service)
    assert.equal(run.estimate!.counted, false, 'senza countTokens si stima dai caratteri')
    const selection = service.defaultSelection(run)
    assert.equal(selection.length, 11, 'tutte quelle con errori o avvisi')
    assert.ok(selection.includes('automation.assenza_soggiorno') && selection.includes('automation.5_min_lavatrice'))

    await assert.rejects(service.analyze(run.id, []), (e: VerifyError) => e.code === 'niente_da_analizzare')
    await service.analyze(run.id, selection)
    const done = await waitFor(s.store, run.id, ['completata', 'errore'], service)
    assert.equal(done.status, 'completata', done.error)
    assert.equal(stream.requests.length, 4, 'lotti da 5, 5 e 1 + una correzione')
    const req = stream.requests[0]!
    assert.equal(req.output_config.effort, 'medium')
    assert.equal(req.output_config.format.type, 'json_schema')
    assert.match(req.messages[0].content, /<automazioni>/)
    assert.match(req.messages[0].content, /problemi_rilevati/)
    assert.equal(stream.requests[3]!.output_config.effort, 'medium')
    assert.match(stream.requests[3]!.messages[0].content, /switch\.inventata non esiste/)

    const a = done.reviews['automation.assenza_soggiorno']!
    assert.equal(a.giudizio, 'problemi')
    const d = s.draftStore.get(a.draftId!)!
    assert.equal(d.kind, 'update')
    assert.deepEqual(d.verification, { runId: run.id, automation: 'automation.assenza_soggiorno' })
    const lav = done.reviews['automation.5_min_lavatrice']!
    assert.equal(lav.repaired, true)
    assert.ok(lav.draftId)
    assert.equal(Object.keys(done.reviews).length, selection.length)
    assert.ok(done.usage!.costUsd > 0)
    const rec = (await import('node:fs/promises')).readFile(join(s.dir, 'usage.jsonl'), 'utf8')
    assert.match(await rec, /"kind":"verify"/)
    const view = service.view(done)
    assert.equal(view.reviews['automation.assenza_soggiorno']!.draft!.status, 'pending')
  } finally {
    await rm(s.dir, { recursive: true, force: true })
  }
})
