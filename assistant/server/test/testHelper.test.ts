import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureTestHelper, TEST_HELPER_ID } from '../src/setup/testHelper.ts'
import { SettingsStore } from '../src/store/settings.ts'
import { fakeHA } from './fakeHome.ts'

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'assistente-helper-'))
  const settings = new SettingsStore(dir)
  await settings.load()
  const created: Array<{ name: string; icon: string }> = []
  const writer = {
    fail: false,
    async createInputBoolean(name: string, icon: string) {
      if (this.fail) throw new Error('HA non raggiungibile')
      created.push({ name, icon })
      return { id: 'test_claude' }
    },
  }
  return { dir, settings, created, writer }
}

test('interruttore di prova: creato una sola volta, anche dopo un riavvio', async () => {
  const t = await setup()
  try {
    const ha = fakeHA()
    assert.equal(await ensureTestHelper({ ha, writer: t.writer, settings: t.settings }), 'creato')
    assert.deepEqual(t.created, [{ name: 'Test Claude', icon: 'mdi:robot-outline' }])
    // Riavvio: le impostazioni ricordano che è già stato gestito, anche se l'utente lo elimina
    const again = new SettingsStore(t.dir)
    await again.load()
    assert.equal(again.get().testHelper?.status, 'creato')
    assert.equal(await ensureTestHelper({ ha, writer: t.writer, settings: again }), 'gia_gestito')
    assert.equal(t.created.length, 1)
  } finally {
    await rm(t.dir, { recursive: true, force: true })
  }
})

test('interruttore di prova: se esiste già non si crea; se HA non risponde si riprova', async () => {
  const t = await setup()
  try {
    const ha = fakeHA()
    const states = await ha.states()
    states.set(TEST_HELPER_ID, { entity_id: TEST_HELPER_ID, state: 'off', attributes: {}, last_changed: '', last_updated: '' })
    assert.equal(await ensureTestHelper({ ha, writer: t.writer, settings: t.settings }), 'esistente')
    assert.equal(t.created.length, 0)
    states.delete(TEST_HELPER_ID)

    const t2 = await setup()
    try {
      t2.writer.fail = true
      assert.equal(await ensureTestHelper({ ha, writer: t2.writer, settings: t2.settings }), 'errore')
      assert.equal(t2.settings.get().testHelper, undefined, 'nessun segno: riproverà')
      t2.writer.fail = false
      assert.equal(await ensureTestHelper({ ha, writer: t2.writer, settings: t2.settings }), 'creato')
    } finally {
      await rm(t2.dir, { recursive: true, force: true })
    }
  } finally {
    await rm(t.dir, { recursive: true, force: true })
  }
})
