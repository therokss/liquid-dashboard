import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WebSocket } from 'ws'
import { HAConnection, HAError, type WebSocketCtor } from '../src/ha/connection.ts'
import { AdminDirectory } from '../src/ha/users.ts'
import { startMockHa } from './mockHa.ts'

const WS = WebSocket as unknown as WebSocketCtor
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

test('si autentica, risponde ai comandi per id e propaga gli errori di HA', async () => {
  const ha = await startMockHa()
  ha.handlers.get_config = () => ({ version: '2026.9.3' })
  const conn = new HAConnection({ url: ha.url, token: 'token-di-test', WebSocketImpl: WS })
  try {
    conn.start()
    await conn.waitReady(2_000)
    assert.equal(conn.state, 'connected')
    assert.equal(conn.haVersion, '2026.9.3')
    const [a, b] = await Promise.all([conn.sendMessage({ type: 'get_config' }), conn.sendMessage({ type: 'get_config' })])
    assert.deepEqual(a, { version: '2026.9.3' })
    assert.deepEqual(b, { version: '2026.9.3' })
    await assert.rejects(conn.sendMessage({ type: 'comando_inesistente' }), (e: HAError) => e.code === 'unknown_command')
  } finally {
    conn.stop()
    await ha.close()
  }
})

test('token rifiutato: stato auth_failed e nessun comando accettato', async () => {
  const ha = await startMockHa()
  const conn = new HAConnection({ url: ha.url, token: 'sbagliato', WebSocketImpl: WS, maxBackoffMs: 60_000 })
  try {
    conn.start()
    await wait(300)
    assert.equal(conn.state, 'auth_failed')
    await assert.rejects(conn.sendMessage({ type: 'get_config' }), (e: HAError) => e.code === 'not_connected')
  } finally {
    conn.stop()
    await ha.close()
  }
})

test('connessione persa: le richieste in volo falliscono e si riconnette da sola', async () => {
  const ha = await startMockHa()
  ha.handlers.lento = () => new Promise(() => undefined) // mai risolto: la risposta non arriva
  ha.handlers.get_config = () => ({ version: '2026.9.3' })
  const conn = new HAConnection({ url: ha.url, token: 'token-di-test', WebSocketImpl: WS, minBackoffMs: 50 })
  try {
    conn.start()
    await conn.waitReady(2_000)
    const inFlight = conn.sendMessage({ type: 'lento' }, 5_000)
    await wait(50)
    ha.dropAll()
    await assert.rejects(inFlight, (e: HAError) => e.code === 'connection_lost')
    await wait(400)
    assert.equal(conn.state, 'connected')
    assert.deepEqual(await conn.sendMessage({ type: 'get_config' }), { version: '2026.9.3' })
  } finally {
    conn.stop()
    await ha.close()
  }
})

test('sottoscrizione: riceve gli eventi e li chiude con unsubscribe_events', async () => {
  const ha = await startMockHa()
  ha.handlers['trigger_platforms/subscribe'] = (msg, ws) => {
    setTimeout(() => ws.send(JSON.stringify({ id: msg.id, type: 'event', event: { state: {}, time: {} } })), 20)
    return null
  }
  ha.handlers.unsubscribe_events = () => null
  const conn = new HAConnection({ url: ha.url, token: 'token-di-test', WebSocketImpl: WS })
  try {
    conn.start()
    await conn.waitReady(2_000)
    const events: unknown[] = []
    const unsubscribe = await conn.subscribe({ type: 'trigger_platforms/subscribe' }, (e) => events.push(e))
    await wait(100)
    assert.deepEqual(events, [{ state: {}, time: {} }])
    await unsubscribe()
    const unsub = ha.received.find((m) => m.type === 'unsubscribe_events')
    const sub = ha.received.find((m) => m.type === 'trigger_platforms/subscribe')
    assert.equal(unsub?.subscription, sub?.id)
  } finally {
    conn.stop()
    await ha.close()
  }
})

test('AdminDirectory: owner e system-admin sono admin, cache rispettata', async () => {
  let calls = 0
  const fake = {
    sendMessage: async () => {
      calls++
      return [
        { id: 'owner', is_owner: true, group_ids: [] },
        { id: 'admin', group_ids: ['system-admin'] },
        { id: 'utente', group_ids: ['system-users'] },
      ]
    },
  } as any
  let now = 1_000_000
  const dir = new AdminDirectory(fake, 5 * 60_000, () => now)
  assert.equal(await dir.isAdmin('owner'), true)
  assert.equal(await dir.isAdmin('admin'), true)
  assert.equal(await dir.isAdmin('utente'), false) // forza un refresh anticipato (utente non in elenco)
  const afterFirst = calls
  assert.equal(await dir.isAdmin('admin'), true)
  assert.equal(calls, afterFirst)
  now += 6 * 60_000
  await dir.isAdmin('admin')
  assert.equal(calls, afterFirst + 1)
})

test('AdminDirectory: HA irraggiungibile senza elenco precedente → null', async () => {
  const dir = new AdminDirectory({ sendMessage: async () => { throw new Error('giù') } } as any)
  assert.equal(await dir.isAdmin('chiunque'), null)
})
