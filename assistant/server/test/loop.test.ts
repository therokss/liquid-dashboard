import { test } from 'node:test'
import assert from 'node:assert/strict'
import Anthropic from '@anthropic-ai/sdk'
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { buildRequest, INTERRUPTED_TOOL, prepareMessages, REFUSAL_TEXT, runTurn, type Frozen, type TurnDeps, type TurnEvent } from '../src/claude/loop.ts'
import { costUsd, messageCost } from '../src/claude/pricing.ts'
import { fakeStream, msg, text, thinking, toolUse, type Step } from './fakeClaude.ts'

const frozen: Frozen = {
  model: 'claude-sonnet-5-5',
  effort: 'medium',
  system: [
    { type: 'text', text: 'istruzioni' },
    { type: 'text', text: '<casa>…</casa>', cache_control: { type: 'ephemeral', ttl: '1h' } },
  ],
  tools: [{ name: 'cerca_entita', description: 'cerca', input_schema: { type: 'object', properties: {} }, eager_input_streaming: true }],
}

function setup(steps: Step[], overrides: Partial<TurnDeps> = {}) {
  const stream = fakeStream(steps)
  const persisted: BetaMessageParam[] = []
  const events: TurnEvent[] = []
  const toolCalls: Array<{ name: string; input: unknown }> = []
  const deps: TurnDeps = {
    stream,
    features: { fallbacks: true, blockBinding: true },
    persist: async (m) => {
      persisted.push(JSON.parse(JSON.stringify(m)))
    },
    executeTool: async (name, input) => {
      toolCalls.push({ name, input })
      return { content: JSON.stringify({ trovate: 1 }), isError: false }
    },
    beforeRequest: () => undefined,
    onUsage: async () => undefined,
    emit: (e) => events.push(e),
    ...overrides,
  }
  return { stream, persisted, events, toolCalls, deps }
}

const user = (t: string): BetaMessageParam => ({ role: 'user', content: [{ type: 'text', text: '<contesto>Adesso: …</contesto>' }, { type: 'text', text: t }] })

test('richiesta: fallback, binding del thinking, effort, cache 1 h + automatica', () => {
  const r = buildRequest(frozen, [user('ciao')], { fallbacks: true, blockBinding: true }) as Record<string, any>
  assert.deepEqual(r.betas, ['server-side-fallback-2026-07-01', 'thinking-binding-controls-2026-08-01'])
  assert.equal(r.fallbacks, 'default')
  assert.deepEqual(r.thinking, { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } })
  assert.deepEqual(r.output_config, { effort: 'medium' })
  assert.deepEqual(r.cache_control, { type: 'ephemeral' })
  assert.equal(r.system[1].cache_control.ttl, '1h')
  assert.equal(r.tool_choice, undefined, 'mai tool_choice forzato (400 sui modelli 5.5)')
  const plain = buildRequest(frozen, [user('ciao')], { fallbacks: false, blockBinding: false }) as Record<string, any>
  assert.equal(plain.betas, undefined)
  assert.equal(plain.fallbacks, undefined)
  assert.deepEqual(plain.thinking, { type: 'adaptive' })
})

test('turno con tool: risultati in un unico messaggio utente, cronologia append-only', async () => {
  const { stream, persisted, events, toolCalls, deps } = setup([
    msg([thinking('a'), text('Controllo.'), toolUse('tu_1', 'cerca_entita', { testo: 'luce' }), toolUse('tu_2', 'cerca_entita', { testo: 'radar' })], 'tool_use'),
    msg([thinking('b'), text('Ci sono 2 luci.')], 'end_turn'),
  ])
  const history = [user('quante luci?')]
  const r = await runTurn(frozen, history, deps, new AbortController().signal)
  assert.equal(r.stopReason, 'end_turn')
  assert.equal(r.steps, 2)
  assert.equal(toolCalls.length, 2)
  assert.deepEqual(persisted.map((m) => m.role), ['assistant', 'user', 'assistant'])
  const results = persisted[1]!.content as any[]
  assert.deepEqual(results.map((b) => [b.type, b.tool_use_id]), [['tool_result', 'tu_1'], ['tool_result', 'tu_2']])
  // Il thinking è salvato com'è (firma inclusa)
  assert.deepEqual((persisted[0]!.content as any[])[0], thinking('a'))
  // La seconda richiesta estende la prima senza toccarla (prefisso identico byte per byte)
  const [r1, r2] = stream.requests
  assert.equal(JSON.stringify(r2!.messages.slice(0, r1!.messages.length)), JSON.stringify(r1!.messages))
  assert.equal(JSON.stringify(r2!.system), JSON.stringify(r1!.system))
  assert.equal(JSON.stringify(r2!.tools), JSON.stringify(r1!.tools))
  assert.ok(events.some((e) => e.type === 'thinking'))
  assert.ok(events.some((e) => e.type === 'tool' && e.id === 'tu_2'))
  assert.equal(events.filter((e) => e.type === 'tool_done').length, 2)
})

test('cronologia riparata: tool_use senza risultato (riavvio) e messaggi utente consecutivi', () => {
  const history: BetaMessageParam[] = [
    user('primo'),
    { role: 'assistant', content: [text('guardo') as any, toolUse('tu_9', 'cerca_entita', {}) as any] },
    // qui l'add-on si è riavviato: nessun tool_result salvato
    user('ci sei?'),
    user('ancora io'), // turno precedente fallito per errore API
  ]
  const a = prepareMessages(history)
  const b = prepareMessages(history)
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'deterministica')
  assert.deepEqual(a.map((m) => m.role), ['user', 'assistant', 'user'])
  const last = a[2]!.content as any[]
  assert.equal(last[0].type, 'tool_result')
  assert.equal(last[0].tool_use_id, 'tu_9')
  assert.equal(last[0].is_error, true)
  assert.equal(last[0].content, INTERRUPTED_TOOL)
  assert.deepEqual(last.slice(1).map((x) => x.text), ['<contesto>Adesso: …</contesto>', 'ci sei?', '<contesto>Adesso: …</contesto>', 'ancora io'])
  // La cronologia salvata non viene modificata
  assert.equal(history.length, 4)
})

test('rifiuto: si salva un testo segnaposto, non l\'output parziale', async () => {
  const { persisted, deps } = setup([msg([text('parziale')], 'refusal')])
  const r = await runTurn(frozen, [user('x')], deps, new AbortController().signal)
  assert.equal(r.stopReason, 'refusal')
  assert.ok(r.notice)
  assert.deepEqual(persisted[0], { role: 'assistant', content: [{ type: 'text', text: REFUSAL_TEXT }] })
})

test('max_tokens con tool_use troncato: niente esecuzione, avviso', async () => {
  const { toolCalls, deps } = setup([msg([toolUse('tu_x', 'cerca_entita', {})], 'max_tokens')])
  const r = await runTurn(frozen, [user('x')], deps, new AbortController().signal)
  assert.equal(r.stopReason, 'max_tokens')
  assert.equal(toolCalls.length, 0)
  assert.match(r.notice!, /troncata/)
})

test('400 su una funzionalità opzionale: si spegne e si riprova', async () => {
  const err = new Anthropic.BadRequestError(400, { type: 'error', error: { type: 'invalid_request_error', message: 'fallbacks: not supported for this model' } }, 'fallbacks: not supported for this model', new Headers())
  const { stream, deps } = setup([err, msg([text('ok')], 'end_turn')])
  const r = await runTurn(frozen, [user('x')], deps, new AbortController().signal)
  assert.equal(r.stopReason, 'end_turn')
  assert.equal(deps.features.fallbacks, false)
  assert.equal(stream.requests[1]!.fallbacks, undefined)
  assert.deepEqual(stream.requests[1]!.betas, ['thinking-binding-controls-2026-08-01'])
})

test('altri errori API: si propagano senza salvare nulla', async () => {
  const err = new Anthropic.AuthenticationError(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 'invalid x-api-key', new Headers())
  const { persisted, deps } = setup([err])
  await assert.rejects(runTurn(frozen, [user('x')], deps, new AbortController().signal), Anthropic.AuthenticationError)
  assert.equal(persisted.length, 0)
})

test('Stop: la richiesta in corso viene annullata e non si salva nulla', async () => {
  const controller = new AbortController()
  const { persisted, deps } = setup([
    (_p, signal) =>
      new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new Anthropic.APIUserAbortError()))
        setTimeout(() => controller.abort(), 10)
      }),
  ])
  const r = await runTurn(frozen, [user('x')], deps, controller.signal)
  assert.equal(r.aborted, true)
  assert.equal(persisted.length, 0)
})

test('budget: il controllo prima di ogni richiesta può fermare il turno', async () => {
  let calls = 0
  const { deps } = setup([msg([toolUse('tu_1', 'cerca_entita', {})], 'tool_use')], {
    beforeRequest: () => {
      if (++calls > 1) throw new Error('budget_superato')
    },
  })
  await assert.rejects(runTurn(frozen, [user('x')], deps, new AbortController().signal), /budget_superato/)
})

test('costi: cache per TTL e tentativi di fallback', () => {
  // Sonnet 5.5: $2 input, $10 output, $0,20 lettura cache; scrittura 1 h = 2× input
  const c = costUsd('claude-sonnet-5-5', {
    input_tokens: 1_000_000,
    output_tokens: 100_000,
    cache_read_input_tokens: 1_000_000,
    cache_creation_input_tokens: 1_000_000,
    cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1_000_000 },
  })
  assert.equal(Math.round(c * 100) / 100, 2 + 1 + 0.2 + 4)
  const m = messageCost({
    model: 'claude-sonnet-5',
    usage: {
      input_tokens: 10,
      output_tokens: 0,
      iterations: [
        { type: 'message', model: 'claude-sonnet-5-5', input_tokens: 1_000_000, output_tokens: 0 },
        { type: 'fallback_message', model: 'claude-sonnet-5', input_tokens: 1_000_000, output_tokens: 0 },
      ],
    },
  })
  assert.equal(m.fallback, true)
  assert.equal(Math.round(m.costUsd * 100) / 100, 2 + 3)
  assert.equal(m.input, 2_000_000)
})
