import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WebSocket } from 'ws'
import { HAConnection, type WebSocketCtor } from '../src/ha/connection.ts'
import { HARest } from '../src/ha/rest.ts'
import { READ_ONLY_WS_TYPES, readOnly, runProbes } from '../src/diagnostics/probes.ts'
import { startMockHa } from './mockHa.ts'

const WS = WebSocket as unknown as WebSocketCtor

test('readOnly rifiuta qualunque comando fuori dall\'elenco, prima di inviarlo', async () => {
  const sent: string[] = []
  const ha = readOnly({
    sendMessage: async (m: any) => { sent.push(m.type); return null },
    subscribe: async () => async () => undefined,
  } as any)
  for (const type of ['call_service', 'execute_script', 'config/entity_registry/update', 'config/category_registry/create']) {
    assert.throws(() => ha.call({ type }), /non ammesso/)
  }
  assert.deepEqual(sent, [])
  assert.equal(READ_ONLY_WS_TYPES.has('call_service'), false)
})

test('runProbes su un HA finto: tutte le verifiche passano e nessun comando di scrittura parte', async () => {
  const mock = await startMockHa()
  const h = mock.handlers
  h.get_config = () => ({ version: '2026.9.3', location_name: 'Casa di prova', time_zone: 'Europe/Rome', components: ['automation', 'sun'] })
  h['config/auth/list'] = () => [{ id: 'a', is_owner: true }, { id: 'b', group_ids: ['system-users'] }]
  h['config/entity_registry/list_for_display'] = () => ({ entity_categories: {}, entities: [{ ei: 'sun.sun' }] })
  h['config/device_registry/list'] = () => []
  h['config/area_registry/list'] = () => [{ area_id: 'soggiorno' }]
  h['config/label_registry/list'] = () => []
  h['config/category_registry/list'] = () => [{ category_id: 'c1', name: 'Luci' }]
  h.get_states = () => [
    { entity_id: 'sun.sun', state: 'above_horizon', attributes: {} },
    { entity_id: 'automation.prova', state: 'on', attributes: { id: '1700000000000', friendly_name: 'Prova' } },
  ]
  h.get_services = () => ({ light: { turn_on: {}, turn_off: {} } })
  h.validate_config = (m) => Object.fromEntries(['triggers', 'conditions', 'actions'].filter((k) => k in m).map((k) => [k, { valid: true, error: null }]))
  h['automation/config'] = () => ({ config: { alias: 'Prova' } })
  h['search/related'] = () => ({ entity: ['sun.sun'] })
  h['trace/list'] = () => [{ item_id: '1700000000000', state: 'stopped', script_execution: 'finished' }]
  h['logbook/get_events'] = () => [{ entity_id: 'light.x', context_user_id: 'u1' }, { entity_id: 'light.y', context_event_type: 'automation_triggered' }]
  h['history/history_during_period'] = () => ({ 'sun.sun': [{ s: 'above_horizon' }] })
  h['recorder/list_statistic_ids'] = () => [{ statistic_id: 'sensor.temperatura_prova' }]
  h['recorder/statistics_during_period'] = () => ({ 'sensor.temperatura_prova': [{ mean: 20 }] })
  h['trigger_platforms/subscribe'] = (m, ws) => {
    setTimeout(() => ws.send(JSON.stringify({ id: m.id, type: 'event', event: { state: {}, time: {}, 'light.turned_on': {} } })), 10)
    return null
  }
  h.unsubscribe_events = () => null
  h['manifest/get'] = () => ({ name: 'Automation', documentation: 'https://www.home-assistant.io/integrations/automation' })

  const conn = new HAConnection({ url: mock.url, token: 'token-di-test', WebSocketImpl: WS })
  // REST finto: risponde come HA all'API ping e alla lettura dell'automazione.
  const rest = { get: async (path: string) => (path === '/' ? { status: 200, ok: true, data: { message: 'API running.' } } : { status: 200, ok: true, data: { alias: 'Prova' } }) } as unknown as HARest
  try {
    conn.start()
    await conn.waitReady(2_000)
    const results = await runProbes({ conn, rest, mode: 'dev' })
    const failed = results.filter((r) => r.status === 'errore')
    assert.deepEqual(failed, [], JSON.stringify(failed))
    assert.ok(results.length >= 14)
    for (const m of mock.received) assert.ok(READ_ONLY_WS_TYPES.has(m.type), `comando non ammesso inviato: ${m.type}`)
    assert.ok(mock.received.some((m) => m.type === 'unsubscribe_events'), 'la sottoscrizione deve essere chiusa')
  } finally {
    conn.stop()
    await mock.close()
  }
})

test('runProbes senza connessione: errori chiari, nessuna eccezione', async () => {
  const rest = new HARest({ mode: 'none', wsUrl: '', restBase: '', token: '' })
  const results = await runProbes({ conn: null, rest, mode: 'none' })
  assert.equal(results[0]?.status, 'saltata')
  assert.ok(results.slice(1).every((r) => r.status === 'errore' || r.status === 'saltata'))
})
