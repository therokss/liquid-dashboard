import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ChatError, ChatService, type JobEvent } from '../src/chat/service.ts'
import { ConversationStore } from '../src/chat/store.ts'
import { toView } from '../src/chat/view.ts'
import { UsageLedger } from '../src/claude/usage.ts'
import { SettingsStore } from '../src/store/settings.ts'
import { DEFAULT_OPTIONS, type Options } from '../src/options.ts'
import { resetSnapshotCache } from '../src/inventory/snapshot.ts'
import { fakeHA } from './fakeHome.ts'
import { fakeStream, msg, text, thinking, toolUse, type Step } from './fakeClaude.ts'

async function setup(steps: Step[], options: Partial<Options> = {}) {
  resetSnapshotCache()
  const dir = await mkdtemp(join(tmpdir(), 'assistente-chat-'))
  const store = new ConversationStore(dir)
  await store.load()
  const settings = new SettingsStore(dir)
  await settings.load()
  const usage = new UsageLedger(dir, () => 'Europe/Rome', () => new Date('2026-10-14T10:00:00Z'))
  await usage.load()
  const stream = fakeStream(steps)
  const opts: Options = { ...DEFAULT_OPTIONS, anthropicApiKey: 'sk-ant-test', ...options }
  const chat = new ChatService({ store, ha: fakeHA(), settings, usage, options: opts, stream, now: () => new Date('2026-10-14T10:00:00Z') })
  return { dir, store, settings, usage, stream, chat, opts }
}

/** Attende la fine del turno raccogliendo gli eventi. */
function collect(chat: ChatService, id: string): Promise<JobEvent[]> {
  return new Promise((resolve) => {
    const events: JobEvent[] = []
    const sub = chat.subscribe(id, null, (e) => {
      events.push(e)
      if (e.event === 'done') resolve(events)
    })
    if (sub?.done) resolve(events)
  })
}

test('chat: conversazione congelata, turno con tool, persistenza e vista', async () => {
  const { dir, store, chat, stream, usage } = await setup([
    msg([thinking(), toolUse('tu_1', 'dettagli_entita', { entity_id: 'light.lampada_arco' })], 'tool_use'),
    msg([thinking(), text('La **lampada** è accesa.')], 'end_turn'),
  ])
  try {
    const { id } = await chat.create('Admin Demo')
    const { turnId } = await chat.send(id, 'La lampada è accesa?')
    const events = await collect(chat, id)
    assert.deepEqual(
      [...new Set(events.map((e) => e.event))],
      ['start', 'thinking', 'tool_pending', 'step', 'tool', 'tool_done', 'text', 'done'],
    )
    assert.ok(events.every((e) => e.id.startsWith(turnId + ':')))
    const tool = events.find((e) => e.event === 'tool')!.data as { label: string }
    assert.equal(tool.label, 'Leggo light.lampada_arco')

    // Richiesta reale: prompt di sistema con l'inventario, contesto orario nel messaggio utente
    const req = stream.requests[0]!
    assert.match(req.system[1].text, /light\.lampada_arco · Lampada arco/)
    assert.match(req.messages[0].content[0].text, /^<contesto>Adesso: mercoledì 14\/10\/2026, ore 12:00 \(Europe\/Rome\)<\/contesto>$/)
    // Il tool ha davvero letto dal finto HA e il risultato è tornato a Claude
    const toolResult = stream.requests[1]!.messages[2].content[0]
    assert.equal(toolResult.type, 'tool_result')
    assert.match(toolResult.content, /"stato":"on"/)

    // Riletta da disco (riavvio): stessa cronologia, titolo, costi
    const reloaded = new ConversationStore(dir)
    await reloaded.load()
    const conv = (await reloaded.get(id))!
    assert.equal(conv.title, 'La lampada è accesa?')
    assert.equal(conv.messages.length, 4)
    assert.equal(reloaded.summary(id)!.turns, 1)
    assert.ok(reloaded.summary(id)!.costUsd > 0)
    assert.ok(usage.monthSpent() > 0)

    const view = toView(conv)
    assert.equal(view.length, 2)
    assert.deepEqual(view[0], { kind: 'user', text: 'La lampada è accesa?', ts: '2026-10-14T10:00:00.000Z' })
    const a = view[1] as Extract<(typeof view)[number], { kind: 'assistant' }>
    assert.deepEqual(a.parts.map((p) => p.type), ['tool', 'text'])
    assert.equal((a.parts[0] as { ok: boolean }).ok, true)
    assert.ok(!JSON.stringify(view).includes('<contesto>'))

    // File append-only: la prima riga è l'intestazione congelata
    const firstLine = JSON.parse((await readFile(join(dir, 'conversations', `${id}.jsonl`), 'utf8')).split('\n')[0]!)
    assert.equal(firstLine.type, 'header')
    assert.equal(firstLine.model, 'claude-sonnet-5-5')
    assert.ok(firstLine.tools.length >= 7)
    assert.ok(!JSON.stringify(firstLine).includes('SN-DA-NON-INVIARE'))
    assert.equal(store.list()[0]!.id, id)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('chat: secondo turno dopo un riavvio a metà tool, senza 400', async () => {
  const { dir, store, chat, stream } = await setup([
    msg([toolUse('tu_1', 'cerca_entita', { testo: 'luce' })], 'tool_use'),
    () => {
      throw new Error('crash simulato')
    },
    msg([text('Eccomi.')], 'end_turn'),
  ])
  try {
    const { id } = await chat.create('admin')
    // Primo turno: il tool_result viene salvato, poi la seconda chiamata fallisce
    await chat.send(id, 'luci?')
    const ev1 = await collect(chat, id)
    assert.ok(ev1.some((e) => e.event === 'error'))
    // Simula un riavvio con un tool_use senza risultato in coda alla cronologia
    await store.append(id, { type: 'message', ts: new Date().toISOString(), message: { role: 'assistant', content: [toolUse('tu_orfano', 'cerca_entita', {}) as any] } })
    const chat2 = new ChatService({ ...(chat as any).deps })
    await chat2.send(id, 'ci sei?')
    await collect(chat2, id)
    const last = stream.requests[stream.requests.length - 1]!
    const lastMsg = last.messages[last.messages.length - 1]
    assert.equal(lastMsg.role, 'user')
    assert.equal(lastMsg.content[0].type, 'tool_result')
    assert.equal(lastMsg.content[0].tool_use_id, 'tu_orfano')
    // Ruoli alternati: requisito dell'API
    const roles = last.messages.map((m: any) => m.role)
    for (let i = 1; i < roles.length; i++) assert.notEqual(roles[i], roles[i - 1])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('chat: budget superato, chiave mancante, turno già in corso', async () => {
  const blocked = await setup([], { monthlyBudgetBlockUsd: 1 })
  try {
    await blocked.usage.record({ kind: 'chat', conversationId: 'x', model: 'claude-sonnet-5-5', input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 1.5 })
    const { id } = await blocked.chat.create('admin')
    await assert.rejects(blocked.chat.send(id, 'ciao'), (e: unknown) => e instanceof ChatError && e.code === 'budget_superato')
    assert.equal(blocked.stream.requests.length, 0)
  } finally {
    await rm(blocked.dir, { recursive: true, force: true })
  }

  const slow = await setup([() => new Promise((r) => setTimeout(() => r(msg([text('ok')], 'end_turn')), 50))])
  try {
    const { id } = await slow.chat.create('admin')
    await slow.chat.send(id, 'uno')
    await assert.rejects(slow.chat.send(id, 'due'), (e: unknown) => e instanceof ChatError && e.code === 'turno_in_corso')
    await collect(slow.chat, id)
    await assert.rejects(slow.chat.send(id, '   '), (e: unknown) => e instanceof ChatError && e.code === 'messaggio_vuoto')
  } finally {
    await rm(slow.dir, { recursive: true, force: true })
  }

  const nokey = await setup([])
  try {
    const chat = new ChatService({ ...(nokey.chat as any).deps, stream: null })
    const { id } = await chat.create('admin')
    await assert.rejects(chat.send(id, 'ciao'), (e: unknown) => e instanceof ChatError && e.code === 'chiave_mancante')
  } finally {
    await rm(nokey.dir, { recursive: true, force: true })
  }
})

test('chat: eventi riascoltabili da Last-Event-ID dopo una disconnessione', async () => {
  const { dir, chat } = await setup([msg([text('uno'), text('due')], 'end_turn')])
  try {
    const { id } = await chat.create('admin')
    await chat.send(id, 'ciao')
    const all = await collect(chat, id)
    const replay: JobEvent[] = []
    chat.subscribe(id, all[2]!.id, (e) => replay.push(e))
    assert.deepEqual(replay.map((e) => e.id), all.slice(3).map((e) => e.id))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('chat + bozze: proponi_automazione crea la scheda, l\'evento arriva a Claude al turno dopo', async () => {
  const { DraftStore } = await import('../src/drafts/store.ts')
  const { DraftService } = await import('../src/drafts/service.ts')
  const { fakeWriter } = await import('./fakeWriter.ts')
  const YAML = 'alias: Luce ospiti\ndescription: Accende la lampada quando arrivano ospiti\ntriggers:\n  - trigger: state\n    entity_id: input_boolean.ospiti\n    to: "on"\nactions:\n  - action: light.turn_on\n    target:\n      entity_id: light.lampada_arco\n'
  const t = await setup([
    msg([toolUse('tu_bozza', 'proponi_automazione', { yaml: YAML, spiegazione: 'Accende la lampada per gli ospiti.' })], 'tool_use'),
    msg([text('Ecco la bozza: controllala nella scheda.')], 'end_turn'),
    msg([text('Perfetto, ora è attiva.')], 'end_turn'),
    msg([text('Prego!')], 'end_turn'),
  ])
  try {
    const ha = (t.chat as any).deps.ha
    const drafts = new DraftStore(t.dir)
    await drafts.load()
    const writer = fakeWriter(await ha.states())
    const service = new DraftService({ store: drafts, ha, writer, conversations: t.store, pollMs: 5, pollTimeoutMs: 1_000 })
    const chat = new ChatService({ ...(t.chat as any).deps, drafts: service })
    const { id } = await chat.create('admin')
    await chat.send(id, 'Accendi la lampada quando attivo ospiti')
    await collect(chat, id)
    const [draft] = drafts.byConversation(id)
    assert.ok(draft, 'bozza creata')
    assert.equal(draft!.toolUseId, 'tu_bozza')
    const result = t.stream.requests[1]!.messages[2].content[0]
    assert.equal(result.is_error, undefined)
    assert.match(result.content, /in attesa/)
    assert.equal(writer.files.size, 0, 'nessuna scrittura senza tap')

    await service.apply(draft!.id, { enabled: true, confirmCritical: false, by: 'admin' })
    await chat.send(id, 'Fatto?')
    await collect(chat, id)
    const last = t.stream.requests[2]!.messages.at(-1)
    const texts = last.content.map((b: any) => b.text)
    assert.match(texts[1], /^<evento id="e[a-z0-9]+">L'utente ha creato l'automazione "Luce ospiti"/)
    assert.equal(texts[2], 'Fatto?')
    // L'evento viene consegnato una sola volta
    await chat.send(id, 'Grazie')
    await collect(chat, id)
    assert.ok(!JSON.stringify(t.stream.requests[3]!.messages.at(-1)).includes('<evento'))
    const conv = (await t.store.get(id))!
    const view = toView(conv)
    assert.ok(!JSON.stringify(view).includes('<evento'))
  } finally {
    await rm(t.dir, { recursive: true, force: true })
  }
})
