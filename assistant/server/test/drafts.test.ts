import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lineDiff, normalizeAutomation, parseYaml, toYaml } from '../src/drafts/automation.ts'
import { checkAutomation, type CheckContext } from '../src/drafts/checks.ts'
import { DraftService, DraftError, configHash, slugCandidates } from '../src/drafts/service.ts'
import { DraftStore } from '../src/drafts/store.ts'
import { ConversationStore } from '../src/chat/store.ts'
import { AUTOMATION_CONFIG, fakeHA, SERVICES } from './fakeHome.ts'
import { fakeWriter } from './fakeWriter.ts'

const GOOD = `alias: Spegni lampada senza presenza
description: Spegne la lampada dopo 10 minuti senza nessuno
triggers:
  - trigger: state
    entity_id: binary_sensor.radar_presenza
    to: "off"
    for: "00:10:00"
actions:
  - action: light.turn_off
    target:
      entity_id: light.lampada_arco
`

function ctxFrom(extra: Partial<CheckContext> = {}): CheckContext {
  const ent = (name: string, deviceClass: string | null = null, privacy = false) => ({ name, deviceClass, privacy })
  return {
    entities: new Map([
      ['light.lampada_arco', ent('Lampada arco')],
      ['binary_sensor.radar_presenza', ent('Radar', 'occupancy')],
      ['sensor.media_temperatura', ent('Temperatura', 'temperature')],
      ['lock.portoncino', ent('Portoncino')],
      ['button.ingresso_apri', ent('Apri ingresso')],
      ['cover.box', ent('Box', 'garage')],
      ['binary_sensor.ingresso_movimento', ent('Movimento ingresso', 'motion', true)],
    ]),
    devices: new Set(['dev_1']),
    areas: new Set(['soggiorno']),
    floors: new Set(),
    labels: new Set(),
    services: new Map(Object.entries(SERVICES).map(([d, l]) => [d, new Set(l)])),
    triggerTypes: new Set(['state', 'numeric_state', 'sun', 'time']),
    ...extra,
  }
}

test('YAML: tag vietati, chiavi duplicate, una sola automazione', () => {
  assert.match(parseYaml('alias: x\npassword: !secret pwd\n').errors.join(), /Tag non ammessi: !secret/)
  assert.match(parseYaml('a: !include altro.yaml\n').errors.join(), /!include/)
  assert.ok(parseYaml('alias: a\nalias: b\n').errors.length > 0)
  assert.match(normalizeAutomation(parseYaml('- alias: a\n- alias: b\n').value).errors.join(), /una sola automazione/)
  assert.match(normalizeAutomation({ use_blueprint: { path: 'x.yaml' }, alias: 'x' }).errors.join(), /blueprint/)
})

test('normalizzazione: sintassi legacy convertita, chiavi ordinate, errori chiari', () => {
  const r = normalizeAutomation(
    parseYaml(`id: "123"
mode: restart
action:
  - service: light.turn_on
    target: { entity_id: light.lampada_arco }
  - choose:
      - conditions: []
        sequence:
          - service: light.turn_off
trigger:
  platform: state
  entity_id: binary_sensor.radar_presenza
alias: Prova
`).value,
  )
  assert.deepEqual(r.errors, [])
  assert.deepEqual(Object.keys(r.config!), ['alias', 'triggers', 'actions', 'mode'])
  assert.deepEqual(r.config!.triggers, [{ trigger: 'state', entity_id: 'binary_sensor.radar_presenza' }])
  const actions = r.config!.actions as any[]
  assert.equal(actions[0].action, 'light.turn_on')
  assert.equal(actions[1].choose[0].sequence[0].action, 'light.turn_off')
  assert.ok(r.fixes.length >= 3)
  assert.match(r.warnings.join(), /description/)
  assert.ok(!('id' in r.config!), "l'id lo decide l'add-on")

  const bad = normalizeAutomation({ alias: '', triggers: [], actions: [], mode: 'boh', icon: 'x' })
  assert.match(bad.errors.join(' | '), /Chiavi non ammesse: icon/)
  assert.match(bad.errors.join(' | '), /alias/)
  assert.match(bad.errors.join(' | '), /almeno un trigger/)
  assert.match(bad.errors.join(' | '), /mode/)
})

test('controlli: entità e servizi inesistenti, servizi vietati, template', () => {
  const base = normalizeAutomation(parseYaml(GOOD).value).config!
  assert.deepEqual(checkAutomation(base, ctxFrom()).errors, [])

  const wrong = { ...base, actions: [{ action: 'light.turn_off', target: { entity_id: 'light.inventata' } }] }
  assert.match(checkAutomation(wrong, ctxFrom()).errors.join(), /light\.inventata non esiste/)

  const shell = { ...base, actions: [{ action: 'shell_command.riavvia' }] }
  assert.match(checkAutomation(shell, ctxFrom()).errors.join(), /non è ammesso/)
  const restart = { ...base, actions: [{ if: [{ condition: 'state', entity_id: 'light.lampada_arco', state: 'on' }], then: [{ action: 'homeassistant.restart' }] }] }
  assert.match(checkAutomation(restart, ctxFrom()).errors.join(), /actions\[0\]\.then\[0\].*non è ammesso/)
  const tpl = { ...base, actions: [{ action: "{{ 'shell_' ~ 'command.x' }}" }] }
  assert.match(checkAutomation(tpl, ctxFrom()).errors.join(), /template/)
  const missing = { ...base, actions: [{ action: 'light.esplodi' }] }
  assert.match(checkAutomation(missing, ctxFrom()).errors.join(), /non esiste in questa installazione/)

  const withTemplate = { ...base, conditions: [{ condition: 'template', value_template: "{{ states('sensor.media_temperatura') | float > 20 and is_state('sensor.sparito', 'on') }}" }] }
  const r = checkAutomation(withTemplate, ctxFrom())
  assert.deepEqual(r.errors, [])
  assert.match(r.warnings.join(), /sensor\.sparito/)
  assert.ok(r.entities.includes('sensor.media_temperatura'))
})

test('controlli: entità critiche riconosciute nelle azioni, non nei trigger', () => {
  const base = normalizeAutomation(parseYaml(GOOD).value).config!
  const critical = (actions: unknown[]) => checkAutomation({ ...base, actions }, ctxFrom()).critical.map((c) => c.ref)
  assert.deepEqual(critical([{ action: 'lock.unlock', target: { entity_id: 'lock.portoncino' } }]), ['lock.unlock', 'lock.portoncino'])
  assert.deepEqual(critical([{ action: 'button.press', target: { entity_id: 'button.ingresso_apri' } }]), ['button.ingresso_apri'])
  assert.deepEqual(critical([{ action: 'mqtt.publish', data: { topic: 'x', payload: 'y' } }]), ['mqtt.publish'])
  assert.deepEqual(critical([{ action: 'light.turn_on', target: { entity_id: 'light.lampada_arco' } }]), [])
  // Nei trigger una serratura non è critica: l'automazione non la comanda.
  const trig = { ...base, triggers: [{ trigger: 'state', entity_id: 'lock.portoncino', to: 'unlocked' }] }
  assert.deepEqual(checkAutomation(trig, ctxFrom()).critical, [])
})

test('YAML in uscita sicuro per Home Assistant (regole 1.1)', () => {
  const y = toYaml({ alias: 'x', triggers: [{ trigger: 'state', entity_id: 'a.b', to: 'off', for: '00:10:00' }], conditions: [{ condition: 'state', entity_id: 'a.b', state: 'on' }] })
  assert.match(y, /to: "off"/)
  assert.match(y, /for: "00:10:00"/)
  assert.match(y, /state: "on"/)
})

test('diff a righe e slug degli entity_id', () => {
  const d = lineDiff('a\nb\nc\n', 'a\nB\nc\nd\n')
  assert.deepEqual(d.map((x) => x.op + x.line), [' a', '-b', '+B', ' c', '+d'])
  assert.equal(slugCandidates("Spegni l'aria è sera")[0], 'automation.spegni_laria_e_sera')
  assert.ok(slugCandidates("Spegni l'aria")!.includes('automation.spegni_l_aria'))
})

async function setup(opts: { initial?: Record<string, any> } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'assistente-bozze-'))
  const ha = fakeHA()
  const states = await ha.states()
  const writer = fakeWriter(states, opts.initial ?? { '1700000000001': (({ id: _id, ...rest }) => rest)(AUTOMATION_CONFIG) })
  const store = new DraftStore(dir)
  await store.load()
  const conversations = new ConversationStore(dir)
  await conversations.load()
  await conversations.create({
    type: 'header', v: 1, id: 'cprova00000001', createdAt: '2026-10-14T10:00:00.000Z', createdBy: 'test', model: 'claude-sonnet-5-5', effort: 'medium',
    toolsetVersion: 2, promptVersion: 2, haVersion: '2026.9.3', timeZone: 'Europe/Rome', system: [], tools: [],
    inventoryStats: { totalEntities: 0, included: 0, forcedByAutomations: 0, excludedPrivacy: { posizione: 0, telecamere: 0, appMobile: 0 }, byDomain: {}, automations: 0 },
  })
  const service = new DraftService({ store, ha, writer, conversations, pollMs: 5, pollTimeoutMs: 1_000 })
  const call = { conversationId: 'cprova00000001', toolUseId: 'tu_1' }
  return { dir, ha, writer, store, conversations, service, call, states }
}

test('bozza nuova: proposta, conferma, categoria, disattivata, evento, Annulla', async () => {
  const t = await setup()
  try {
    const p = await t.service.propose({ yaml: GOOD, spiegazione: 'Spegne la lampada quando la stanza resta vuota.' }, t.call)
    assert.equal(p.ok, true)
    if (!p.ok) return
    assert.equal(p.draft.kind, 'create')
    assert.equal(p.draft.checks.every((c) => c.ok), true)
    assert.equal(t.writer.calls.filter((c) => c.startsWith('save')).length, 0, 'proporre non scrive nulla')
    const vc = t.ha.calls.find((c) => c.type === 'validate_config')!
    assert.ok(vc.triggers && vc.actions && !('conditions' in vc))

    const applied = await t.service.apply(p.draft.id, { enabled: false, confirmCritical: false, by: 'Admin Demo' })
    assert.equal(applied.status, 'applied')
    const a = applied.applied!
    assert.equal(a.entityId, 'automation.spegni_lampada_senza_presenza')
    assert.equal(t.writer.files.get(a.automationId)!.id, a.automationId)
    assert.equal(t.writer.entityCategory.get(a.entityId!), 'cat_claude')
    assert.equal(t.states.get(a.entityId!)!.state, 'off', 'creata disattivata')
    assert.ok(t.writer.calls.includes(`enabled ${a.entityId} false`))

    const conv = (await t.conversations.get('cprova00000001'))!
    const ev = conv.lines.filter((l) => l.type === 'event')
    assert.equal(ev.length, 1)
    assert.match((ev[0] as any).text, /ha creato l'automazione "Spegni lampada senza presenza".*disattivata/)
    const history = await t.store.history()
    assert.equal(history[0]!.action, 'creata')
    assert.equal(history[0]!.by, 'Admin Demo')

    await assert.rejects(t.service.apply(p.draft.id, { enabled: true, confirmCritical: false, by: 'x' }), (e: unknown) => e instanceof DraftError && e.status === 409)

    const undone = await t.service.undo(p.draft.id, { force: false, by: 'Admin Demo' })
    assert.equal(undone.status, 'undone')
    assert.equal(t.writer.files.has(a.automationId), false)
    assert.equal((await t.store.history())[0]!.action, 'annullata_creazione')
  } finally {
    await rm(t.dir, { recursive: true, force: true })
  }
})

test('bozza respinta: errori per Claude, nessun salvataggio', async () => {
  const t = await setup()
  try {
    const bad = await t.service.propose({ yaml: GOOD.replace('light.lampada_arco', 'light.inventata'), spiegazione: 'x' }, t.call)
    assert.equal(bad.ok, false)
    if (!bad.ok) assert.match(bad.errors.join(), /light\.inventata/)
    const ha = await t.service.propose({ yaml: GOOD.replace('to: "off"', 'to: "NON_VALIDO"'), spiegazione: 'x' }, t.call)
    assert.equal(ha.ok, false)
    if (!ha.ok) assert.match(ha.errors.join(), /Home Assistant rifiuta i trigger/)
    const secret = await t.service.propose({ yaml: GOOD + 'variables:\n  pin: !secret pin\n', spiegazione: 'x' }, t.call)
    assert.equal(secret.ok, false)
    assert.equal(t.store.byConversation('cprova00000001').length, 0)
  } finally {
    await rm(t.dir, { recursive: true, force: true })
  }
})

test('entità critiche: senza doppia conferma non si scrive', async () => {
  const t = await setup()
  try {
    const yaml = GOOD.replace('action: light.turn_off\n    target:\n      entity_id: light.lampada_arco', 'action: mqtt.publish\n    data:\n      topic: casa/porta\n      payload: apri')
    const p = await t.service.propose({ yaml, spiegazione: 'x' }, t.call)
    assert.equal(p.ok, true)
    if (!p.ok) return
    assert.deepEqual(p.draft.critical.map((c) => c.ref), ['mqtt.publish'])
    await assert.rejects(t.service.apply(p.draft.id, { enabled: true, confirmCritical: false, by: 'x' }), (e: unknown) => e instanceof DraftError && e.code === 'conferma_richiesta')
    assert.equal(t.writer.calls.filter((c) => c.startsWith('save')).length, 0)
    const ok = await t.service.apply(p.draft.id, { enabled: true, confirmCritical: true, by: 'x' })
    assert.equal(ok.status, 'applied')
  } finally {
    await rm(t.dir, { recursive: true, force: true })
  }
})

test('modifica: diff, backup, conflitto, Annulla ripristina, Annulla dopo modifica esterna', async () => {
  const t = await setup()
  try {
    const current = t.writer.files.get('1700000000001')!
    const { id: _id, ...rest } = current
    const changed = toYaml({ ...rest, mode: 'restart' })
    const same = await t.service.propose({ yaml: toYaml(rest), spiegazione: 'x', sostituisce: 'automation.luci_sera' }, t.call)
    assert.equal(same.ok, false, 'identica: niente bozza')

    const p = await t.service.propose({ yaml: changed, spiegazione: 'Riparte se scatta di nuovo.', sostituisce: '1700000000001' }, t.call)
    assert.equal(p.ok, true)
    if (!p.ok) return
    assert.equal(p.draft.kind, 'update')
    assert.ok(p.draft.diff!.some((l) => l.op === '+' && l.line === 'mode: restart'))
    assert.ok(p.draft.diff!.some((l) => l.op === '-' && l.line === 'mode: single'))

    // Modificata da qualcun altro dopo la proposta → rifiuto
    t.writer.externalEdit('1700000000001', { description: 'cambiata a mano' })
    await assert.rejects(t.service.apply(p.draft.id, { enabled: true, confirmCritical: false, by: 'x' }), (e: unknown) => e instanceof DraftError && e.code === 'modificata_nel_frattempo')
    t.writer.externalEdit('1700000000001', { description: current.description })

    const applied = await t.service.apply(p.draft.id, { enabled: true, confirmCritical: false, by: 'x' })
    assert.equal(t.writer.files.get('1700000000001')!.mode, 'restart')
    const backup = JSON.parse(await readFile(applied.applied!.backupFile!, 'utf8'))
    assert.equal(backup.config.mode, 'single')
    assert.equal(t.writer.entityCategory.size, 0, 'nelle modifiche la categoria esistente non si tocca')

    // Modifica esterna dopo l'applicazione: Annulla chiede conferma
    t.writer.externalEdit('1700000000001', { alias: 'Luci sera (a mano)' })
    await assert.rejects(t.service.undo(p.draft.id, { force: false, by: 'x' }), (e: unknown) => e instanceof DraftError && e.code === 'modificata_dopo')
    await t.service.undo(p.draft.id, { force: true, by: 'x' })
    assert.equal(configHash(t.writer.files.get('1700000000001')), configHash(current))
  } finally {
    await rm(t.dir, { recursive: true, force: true })
  }
})

test('automazione non caricabile dopo il salvataggio: rollback automatico', async () => {
  const t = await setup()
  try {
    const p = await t.service.propose({ yaml: GOOD.replace('description: Spegne', 'description: NON_CARICABILE Spegne'), spiegazione: 'x' }, t.call)
    assert.equal(p.ok, true)
    if (!p.ok) return
    await assert.rejects(t.service.apply(p.draft.id, { enabled: true, confirmCritical: false, by: 'x' }), (e: unknown) => e instanceof DraftError && e.code === 'non_caricata')
    assert.equal([...t.writer.files.keys()].length, 1, 'rimasta solo quella preesistente')
    assert.equal(t.store.get(p.draft.id)!.status, 'pending')
    assert.equal((await t.store.history())[0]!.action, 'rollback_automatico')
  } finally {
    await rm(t.dir, { recursive: true, force: true })
  }
})

test('scarta: stato e evento per Claude', async () => {
  const t = await setup()
  try {
    const p = await t.service.propose({ yaml: GOOD, spiegazione: 'x' }, t.call)
    if (!p.ok) throw new Error('attesa bozza valida')
    await t.service.discard(p.draft.id, 'x')
    assert.equal(t.store.get(p.draft.id)!.status, 'discarded')
    const conv = (await t.conversations.get('cprova00000001'))!
    assert.match((conv.lines.find((l) => l.type === 'event') as any).text, /scartato/)
    // Riletta da disco
    const reloaded = new DraftStore(t.dir)
    await reloaded.load()
    assert.equal(reloaded.get(p.draft.id)!.status, 'discarded')
  } finally {
    await rm(t.dir, { recursive: true, force: true })
  }
})
