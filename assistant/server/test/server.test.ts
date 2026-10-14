import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { createApp } from '../src/http/server.ts'
import { buildRoutes } from '../src/routes.ts'
import { HARest } from '../src/ha/rest.ts'
import { DEFAULT_OPTIONS } from '../src/options.ts'

async function start() {
  const www = await mkdtemp(join(tmpdir(), 'assistente-www-'))
  await mkdir(join(www, 'assets'))
  await writeFile(join(www, 'index.html'), '<!doctype html><title>Assistente</title>')
  await writeFile(join(www, 'assets', 'app-abc.js'), 'console.log(1)')
  const server = createApp({
    routes: buildRoutes({
      mode: 'dev',
      conn: null,
      rest: new HARest({ mode: 'none', wsUrl: '', restBase: '', token: '' }),
      options: { ...DEFAULT_OPTIONS, anthropicApiKey: 'sk-ant-segreta-di-test' },
      addon: null,
    }),
    wwwDir: www,
    access: { mode: 'dev', isAdmin: async () => true },
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { base, close: () => new Promise<void>((r) => server.close(() => r())) }
}

test('healthz senza autenticazione, sessione senza chiave API', async () => {
  const app = await start()
  try {
    const health = await fetch(`${app.base}/healthz`)
    assert.equal(health.status, 200)
    const session = await fetch(`${app.base}/api/session`)
    const text = await session.text()
    assert.equal(session.status, 200)
    assert.ok(!text.includes('sk-ant-segreta-di-test'), 'la chiave non deve mai arrivare al browser')
    const body = JSON.parse(text)
    assert.equal(body.options.anthropicConfigured, true)
    assert.equal(body.options.chatModel, 'claude-sonnet-5-5')
    assert.equal(body.options.analysisModel, 'claude-opus-5-5')
  } finally {
    await app.close()
  }
})

test('file statici: index senza cache, asset immutabili, niente path traversal', async () => {
  const app = await start()
  try {
    const index = await fetch(`${app.base}/`)
    assert.equal(index.status, 200)
    assert.equal(index.headers.get('cache-control'), 'no-cache')
    const asset = await fetch(`${app.base}/assets/app-abc.js`)
    assert.match(asset.headers.get('cache-control') ?? '', /immutable/)
    const traversal = await fetch(`${app.base}/%2e%2e/%2e%2e/etc/passwd`)
    assert.ok([400, 404].includes(traversal.status))
    const unknownApi = await fetch(`${app.base}/api/nulla`)
    assert.equal(unknownApi.status, 404)
  } finally {
    await app.close()
  }
})

test('SSE: gli eventi arrivano uno alla volta, non tutti insieme alla fine', async () => {
  const app = await start()
  try {
    const res = await fetch(`${app.base}/api/diag/sse-test?seconds=3`)
    assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8')
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    const arrivals: number[] = []
    let buffer = ''
    const t0 = Date.now()
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        if (frame.includes('event: tick')) arrivals.push(Date.now() - t0)
      }
    }
    assert.equal(arrivals.length, 3)
    assert.ok(arrivals[1]! - arrivals[0]! >= 700, `tick troppo ravvicinati: ${arrivals.join(', ')}`)
  } finally {
    await app.close()
  }
})

test('diagnostica Anthropic senza chiave: risposta chiara, nessuna chiamata di rete', async () => {
  const { pingAnthropic } = await import('../src/claude/client.ts')
  const r = await pingAnthropic({ ...DEFAULT_OPTIONS, anthropicApiKey: '' })
  assert.deepEqual(r, { configured: false, models: [] })
})
