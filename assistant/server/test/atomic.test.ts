import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendJsonl, readJson, readJsonl, writeJsonAtomic } from '../src/store/atomic.ts'

test('scrittura atomica: rilettura identica e nessun file temporaneo rimasto', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'assistente-'))
  const file = join(dir, 'sotto', 'dati.json')
  await writeJsonAtomic(file, { a: 1, b: ['x'] })
  assert.deepEqual(await readJson(file, null), { a: 1, b: ['x'] })
  assert.deepEqual(await readdir(join(dir, 'sotto')), ['dati.json'])
})

test('scritture concorrenti sullo stesso file: vince l\'ultima, il file resta valido', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'assistente-'))
  const file = join(dir, 'conteggio.json')
  await Promise.all(Array.from({ length: 20 }, (_, i) => writeJsonAtomic(file, { i })))
  assert.deepEqual(await readJson(file, null), { i: 19 })
})

test('readJson restituisce il fallback se il file manca o è corrotto', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'assistente-'))
  assert.deepEqual(await readJson(join(dir, 'assente.json'), { vuoto: true }), { vuoto: true })
  await writeFile(join(dir, 'rotto.json'), '{ non json')
  assert.equal(await readJson(join(dir, 'rotto.json'), 42), 42)
})

test('JSONL: append in ordine e riga troncata ignorata', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'assistente-'))
  const file = join(dir, 'log.jsonl')
  for (let i = 0; i < 5; i++) await appendJsonl(file, { i })
  await writeFile(file, '{"tronca', { flag: 'a' })
  const rows = await readJsonl<{ i: number }>(file)
  assert.deepEqual(rows.map((r) => r.i), [0, 1, 2, 3, 4])
})
