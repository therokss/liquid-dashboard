import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifyCause, collectActivity, defaultUserKind, normalizeEntry } from '../src/suggest/collect.ts'
import { isItalianHoliday, LocalClock } from '../src/suggest/clock.ts'
import { sunTimes } from '../src/suggest/sun.ts'
import { mine, wilsonLower } from '../src/suggest/miner.ts'
import { SuggestService, SuggestError } from '../src/suggest/service.ts'
import { SuggestStore } from '../src/suggest/store.ts'
import { DraftService } from '../src/drafts/service.ts'
import { DraftStore } from '../src/drafts/store.ts'
import { ConversationStore } from '../src/chat/store.ts'
import { UsageLedger } from '../src/claude/usage.ts'
import { SettingsStore } from '../src/store/settings.ts'
import { DEFAULT_OPTIONS } from '../src/options.ts'
import { DEFAULT_CONSENTS } from '../src/inventory/privacy.ts'
import type { SuggestRun } from '../src/suggest/store.ts'
import { fakeHA, USERS } from './fakeHome.ts'
import { fakeWriter } from './fakeWriter.ts'
import { fakeStream, msg, text, thinking } from './fakeClaude.ts'
import { fakeActivity, NOW, at, days } from './fakeActivity.ts'

const users = new Map(USERS.map((u) => [String(u.id), defaultUserKind({ name: String(u.name), systemGenerated: Boolean(u.system_generated) })]))

test('cause dal Registro attività: automazione, script, persona, strumenti, voce, dispositivo', () => {
  assert.deepEqual(classifyCause({ context_event_type: 'automation_triggered', context_entity_id: 'automation.x' }, users), { c: 'automazione', by: 'automation.x' })
  assert.deepEqual(classifyCause({ context_event_type: 'script_started', context_entity_id: 'script.y', context_user_id: 'a'.repeat(32) }, users), { c: 'script', by: 'script.y' })
  assert.equal(classifyCause({ context_user_id: 'a'.repeat(32) }, users).c, 'manuale')
  assert.equal(classifyCause({ context_user_id: 'b'.repeat(32) }, users).c, 'sistema', 'Supervisor = strumento')
  assert.equal(classifyCause({ context_user_id: 'c'.repeat(32) }, users).c, 'manuale', 'Cloud = comandi vocali')
  assert.equal(classifyCause({ context_user_id: 'd'.repeat(32) }, users).c, 'sistema', 'Node-RED per nome')
  assert.equal(classifyCause({ context_event_type: 'homekit_state_change', context_domain: 'homekit' }, users).c, 'manuale')
  assert.equal(classifyCause({ context_entity_id: 'light.gruppo' }, users).c, 'altro')
  assert.equal(classifyCause({}, users).c, 'fisico')
})

test('voci del Registro attività normalizzate: secondi → ms, persone solo casa/fuori, tipo di evento', () => {
  const ev = normalizeEntry({ when: 1_760_000_000.5, entity_id: 'person.demo', state: 'Ufficio' }, users, DEFAULT_CONSENTS)!
  assert.equal(ev.t, 1_760_000_000_500)
  assert.equal(ev.s, 'not_home')
  const btn = normalizeEntry({ when: 1_760_000_000, entity_id: 'event.pulsante', state: '2026-10-14T10:00:00+00:00', attributes: { event_type: 'double' } }, users, DEFAULT_CONSENTS)!
  assert.equal(btn.et, 'double')
  assert.equal(normalizeEntry({ when: 1, entity_id: 'light.x', state: 'unavailable' }, users, DEFAULT_CONSENTS), null)
})

test('ora locale, festivi italiani, alba e tramonto plausibili', () => {
  const clock = new LocalClock('Europe/Rome', 'IT')
  const lt = clock.at(Date.parse('2026-10-14T05:30:00Z'))
  assert.deepEqual([lt.day, lt.dow, Math.round(lt.min)], ['2026-10-14', 3, 7 * 60 + 30])
  assert.equal(clock.dayType('2026-12-08', 2), 'festivo')
  assert.ok(isItalianHoliday('2027-03-29'), 'Pasquetta 2027')
  assert.equal(clock.dayType('2026-10-13', 2), 'feriale')
  assert.equal(new Date(clock.startOfDay(Date.parse('2026-10-25T12:00:00Z'))).toISOString(), '2026-10-24T22:00:00.000Z')
  const s = sunTimes('2026-10-14', 41.9, 12.5)!
  const local = (ms: number) => Math.round(clock.at(ms).min)
  assert.ok(Math.abs(local(s.rise) - (7 * 60 + 21)) < 15, `alba ${local(s.rise)}`)
  assert.ok(Math.abs(local(s.set) - (18 * 60 + 31)) < 15, `tramonto ${local(s.set)}`)
  assert.ok(wilsonLower(20, 20) > 0.85 && wilsonLower(2, 2) < 0.6)
})

test('miner: associazione col buio, routine, routine esterna, dimenticanze, pulsante; la coperta va in Verifica', () => {
  const r = mine(fakeActivity(), { now: NOW })
  assert.equal(r.observedDays, 20)
  assert.deepEqual(r.dayCounts, { feriale: 14, festivo: 6 })
  const by = (kind: string, entity: string) => r.candidates.find((c) => c.kind === kind && c.entities[0] === entity)

  const assoc = by('associazione', 'light.cucina')!
  assert.ok(assoc, 'movimento → luce cucina')
  assert.deepEqual(assoc.entities, ['light.cucina', 'binary_sensor.movimento_cucina'])
  assert.equal((assoc.dossier.condizione as { tipo: string }).tipo, 'buio')
  assert.equal((assoc.dossier.numeri as { volte: number }).volte, 20)
  assert.ok(!r.candidates.some((c) => c.kind === 'routine' && c.signature.includes('light.cucina=on')), 'stessa accensione: niente doppione come routine')

  const morning = r.candidates.find((c) => c.signature === 'routine:cover.tapparella_camera=open:feriale')!
  assert.match(morning.title, /07:3\d nei giorni feriali/)
  assert.ok(r.candidates.some((c) => c.signature === 'routine:cover.tapparella_camera=open:festivo'))
  assert.ok(by('routine_esterna', 'light.esterno'), 'programma esterno delle 19:00')
  assert.ok(by('dimenticata_fuori', 'light.soggiorno'))
  assert.ok(!r.candidates.some((c) => c.kind === 'associazione' && c.entities[0] === 'light.soggiorno'), 'arrivare e spegnere non è un\'abitudine')
  assert.ok(by('pulsante', 'event.pulsante_camera'))
  assert.equal(r.deferred.length, 1)
  assert.equal(r.deferred[0]!.automation, 'Luce ingresso alla porta')

  // Ogni esempio è confrontabile col Registro attività: giorno, data e ora locale.
  assert.match(assoc.examples[0]!, /^(lun|mar|mer|gio|ven|sab|dom) \d\d\/\d\d \d\d:\d\d · /)
  // Nei dossier per Claude non finiscono id utente né coordinate.
  const dossiers = JSON.stringify(r.candidates.map((c) => c.dossier))
  assert.ok(!dossiers.includes('u'.repeat(32)) && !dossiers.includes('41.9'))

  const again = mine(fakeActivity(), { now: NOW, dismissed: new Set([assoc.signature]) })
  assert.ok(!again.candidates.some((c) => c.signature === assoc.signature), 'una proposta scartata non torna')
})

test('raccolta: logbook a blocchi di un giorno, cause, privacy e indice delle automazioni', async () => {
  const ha = fakeHA()
  const d = days()
  for (const day of d.slice(-3)) {
    ha.logbook.push({ when: at(day, '19:00:00') / 1000, entity_id: 'binary_sensor.radar_presenza', state: 'on' })
    ha.logbook.push({ when: at(day, '19:00:20') / 1000, entity_id: 'light.lampada_arco', state: 'on', context_user_id: 'a'.repeat(32) })
    ha.logbook.push({ when: at(day, '23:00:00') / 1000, entity_id: 'light.lampada_arco', state: 'off', context_event_type: 'automation_triggered', context_entity_id: 'automation.luci_sera' })
    ha.logbook.push({ when: at(day, '23:00:00') / 1000, entity_id: 'device_tracker.telefono', state: 'home' })
  }
  const phases: string[] = []
  const a = await collectActivity(ha, { days: 5, now: new Date(NOW), consents: DEFAULT_CONSENTS, onProgress: (p) => phases.push(p.phase) })
  const logbookCalls = ha.calls.filter((c) => c.type === 'logbook/get_events')
  assert.equal(logbookCalls.length, 6, '5 giorni pieni + oggi')
  assert.ok(!(logbookCalls[0]!.entity_ids as string[]).includes('device_tracker.telefono'), 'GPS esclusi per privacy')
  assert.ok((logbookCalls[0]!.entity_ids as string[]).includes('light.lampada_arco'))
  assert.equal(a.events.length, 9)
  assert.deepEqual(a.stats.byCause, { manuale: 3, automazione: 3, script: 0, sistema: 0, fisico: 3, altro: 0 })
  assert.deepEqual(a.location, { lat: 41.9, lon: 12.5 })
  const luci = a.automations.find((x) => x.entityId === 'automation.luci_sera')!
  assert.deepEqual(luci.triggerKinds, ['sun', 'webhook'])
  assert.ok(luci.actionEntities.includes('light.lampada_arco'))
  assert.ok(luci.conditionEntities.includes('binary_sensor.radar_presenza'))
  assert.ok(phases.includes('Registro attività'))
})

async function setup(opts: { block?: number } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'assistente-suggest-'))
  const ha = fakeHA()
  const states = await ha.states()
  const writer = fakeWriter(states)
  const conversations = new ConversationStore(dir)
  await conversations.load()
  const draftStore = new DraftStore(dir)
  await draftStore.load()
  const drafts = new DraftService({ store: draftStore, ha, writer, conversations, sleep: async () => undefined, pollMs: 1, pollTimeoutMs: 200 })
  const settings = new SettingsStore(dir)
  await settings.load()
  const now = () => new Date(NOW)
  const usage = new UsageLedger(dir, () => 'Europe/Rome', now)
  await usage.load()
  const store = new SuggestStore(dir, now)
  await store.load()
  const chats: string[] = []
  const chat = {
    create: async () => ({ id: 'cprova12345' }),
    send: async (_id: string, t: string) => {
      chats.push(t)
      return { turnId: 't1' }
    },
  }
  return { dir, ha, store, draftStore, drafts, settings, usage, chat, chats, options: { ...DEFAULT_OPTIONS, anthropicApiKey: 'x', monthlyBudgetBlockUsd: opts.block ?? 50 }, now }
}

const GOOD = `alias: Luce col movimento
description: Accende la lampada quando c'è qualcuno e fa buio
triggers:
  - trigger: state
    entity_id: binary_sensor.radar_presenza
    to: "on"
conditions:
  - condition: state
    entity_id: sun.sun
    state: below_horizon
actions:
  - action: light.turn_on
    target:
      entity_id: light.lampada_arco
mode: single`

async function waitFor(store: SuggestStore, id: string, statuses: string[], service?: SuggestService): Promise<SuggestRun> {
  for (let i = 0; i < 500; i++) {
    const r = store.get(id)!
    if (statuses.includes(r.status)) {
      await service?.idle()
      return r
    }
    await new Promise((res) => setTimeout(res, 10))
  }
  throw new Error(`stato atteso ${statuses.join('/')}, trovato ${store.get(id)?.status}`)
}

test('Suggerisci: analisi locale, una chiamata strutturata a Opus, bozze con una correzione', async () => {
  const s = await setup()
  try {
    const answer = (ids: string[]) =>
      msg(
        [
          thinking(),
          text(
            JSON.stringify({
              proposte: ids.map((id, i) =>
                i === 0
                  ? { candidato: id, esito: 'proponi', titolo: 'Luce cucina col movimento al buio', spiegazione: 'Accesa a mano 20 volte su 20 dopo il movimento, sempre col buio.', yaml: GOOD, confidenza: 'Alta', rischi: '' }
                  : i === 1
                    ? { candidato: id, esito: 'proponi', titolo: 'Tapparella', spiegazione: 'x', yaml: GOOD.replace('state: below_horizon', 'state: NON_VALIDO'), confidenza: 'media', rischi: 'r' }
                    : { candidato: id, esito: 'scarta', titolo: 't', spiegazione: 'Coincidenza.', yaml: '', confidenza: 'bassa', rischi: '' },
              ),
            }),
          ),
        ],
        'end_turn',
        { model: 'claude-opus-5-5', usage: { input_tokens: 3000, output_tokens: 4000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null, iterations: null } },
      )
    let ids: string[] = []
    const stream = fakeStream([
      (params) => {
        ids = [...String((params.messages[0] as { content: string }).content).matchAll(/"id":"(c\d+)"/g)].map((m) => m[1]!)
        return answer(ids)
      },
      () => msg([text(JSON.stringify({ correzioni: [{ candidato: ids[1], yaml: GOOD.replace('Luce col movimento', 'Tapparella al mattino') }] }))], 'end_turn', { model: 'claude-opus-5-5' }),
    ])
    const counted: Array<Record<string, unknown>> = []
    const service = new SuggestService({
      store: s.store,
      ha: s.ha,
      settings: s.settings,
      usage: s.usage,
      options: s.options,
      stream,
      count: async (p) => {
        counted.push(p)
        return 4321
      },
      drafts: s.drafts,
      draftStore: s.draftStore,
      chat: s.chat,
      now: s.now,
      collect: async () => fakeActivity(),
    })

    const started = await service.start('Demo', 21)
    assert.equal(started.status, 'raccolta')
    await assert.rejects(service.start('Demo', 21), (e: SuggestError) => e.code === 'analisi_in_corso')
    const ready = await waitFor(s.store, started.id, ['pronta', 'errore'], service)
    assert.equal(ready.status, 'pronta', ready.error)
    assert.ok(ready.candidates.length >= 6)
    assert.equal(ready.estimate!.inputTokens, 4321)
    assert.equal(ready.estimate!.counted, true)
    assert.ok(ready.estimate!.costUsd > 0.1 && ready.estimate!.costUsd < 1, `stima ${ready.estimate!.costUsd}`)
    assert.equal((counted[0]!.output_config as { format: { type: string } }).format.type, 'json_schema')
    assert.equal(stream.requests.length, 0, 'la raccolta non chiama Claude')

    await service.generate(started.id)
    const done = await waitFor(s.store, started.id, ['completata', 'errore'], service)
    assert.equal(done.status, 'completata', done.error)

    const req = stream.requests[0]!
    assert.equal(req.model, 'claude-opus-5-5')
    assert.equal(req.output_config.effort, 'high')
    assert.equal(req.output_config.format.type, 'json_schema')
    assert.equal(req.tools, undefined)
    assert.match(req.messages[0].content, /<candidati>/)
    assert.ok(!JSON.stringify(req).includes('41.9'), 'coordinate mai inviate')
    assert.equal(stream.requests[1]!.output_config.effort, 'medium', 'correzione più economica')
    assert.match(stream.requests[1]!.messages[0].content, /Home Assistant rifiuta/)

    const r1 = done.results[ids[0]!]!
    assert.equal(r1.confidenza, 'alta')
    const d1 = s.draftStore.get(r1.draftId!)!
    assert.deepEqual(d1.suggestion, { runId: started.id, candidateId: ids[0] })
    assert.equal(d1.conversationId, '')
    const r2 = done.results[ids[1]!]!
    assert.equal(r2.repaired, true)
    assert.ok(r2.draftId)
    assert.equal(done.results[ids[2]!]!.esito, 'scarta')
    assert.ok(done.usage!.costUsd > 0)
    assert.equal(s.usage.monthSpent() > 0, true)

    // L'interfaccia vede le bozze aggiornate; una bozza nata qui si applica come in chat.
    const view = service.view(done)
    assert.equal(view.candidates.find((c) => c.id === ids[0])!.result!.draft!.status, 'pending')
    const applied = await s.drafts.apply(r1.draftId!, { enabled: true, confirmCritical: false, by: 'Demo' })
    assert.equal(applied.status, 'applied')

    // "Non mi interessa": la firma sparisce dalle analisi successive e la bozza in attesa si scarta.
    const second = ids[1]!
    await service.dismiss(started.id, second, 'Demo')
    assert.equal(s.draftStore.get(r2.draftId!)!.status, 'discarded')
    const sig = done.candidates.find((c) => c.id === second)!.signature
    assert.ok(s.store.dismissedSignatures().has(sig))

    // "Discuti in chat": nuova conversazione con i numeri e lo YAML.
    const { conversationId } = await service.discuss(started.id, ids[0]!, 'Demo')
    assert.equal(conversationId, 'cprova12345')
    assert.match(s.chats[0]!, /Numeri calcolati dall'add-on/)
    assert.match(s.chats[0]!, /```yaml/)
    await service.idle()
  } finally {
    await rm(s.dir, { recursive: true, force: true })
  }
})

test('Suggerisci: budget esaurito, risposta rifiutata, riavvio a metà', async () => {
  const s = await setup({ block: 0.0001 })
  try {
    await s.usage.record({ kind: 'chat', conversationId: 'cx', model: 'claude-sonnet-5-5', input: 1, output: 1, cacheRead: 0, cacheWrite: 0, costUsd: 1 })
    const stream = fakeStream([msg([text('{}')], 'refusal', { model: 'claude-opus-5-5' })])
    const deps = { store: s.store, ha: s.ha, settings: s.settings, usage: s.usage, options: s.options, stream, drafts: s.drafts, draftStore: s.draftStore, now: s.now, collect: async () => fakeActivity() }
    const service = new SuggestService(deps)
    const run = await service.start('Demo', 30)
    await waitFor(s.store, run.id, ['pronta'], service)
    await assert.rejects(service.generate(run.id), (e: SuggestError) => e.status === 429)

    const s2 = new SuggestService({ ...deps, options: { ...s.options, monthlyBudgetBlockUsd: 0 } })
    await s2.generate(run.id)
    const failed = await waitFor(s.store, run.id, ['errore', 'completata'], s2)
    assert.equal(failed.status, 'errore')
    assert.match(failed.error!, /rifiutato/)

    // Un'analisi rimasta "in corso" al riavvio diventa "interrotta".
    failed.status = 'raccolta'
    await s.store.save(failed)
    const reloaded = new SuggestStore(s.dir, s.now)
    await reloaded.load()
    assert.equal(reloaded.get(run.id)!.status, 'interrotta')
  } finally {
    await rm(s.dir, { recursive: true, force: true })
  }
})
