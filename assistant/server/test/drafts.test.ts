import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lineDiff, normalizeAutomation, parseYaml, toYaml } from '../src/drafts/automation.ts'
import { checkAutomation, type CheckContext } from '../src/drafts/checks.ts'
import { DraftService, DraftError, configHash, slugCandidates } from '../src/drafts/service.ts'
import { DraftStore } from '../src/drafts/store.ts'
import { normalizeHelper, normalizeScript } from '../src/drafts/objects.ts'
import { publicDraft } from '../src/drafts/service.ts'
import { executeTool } from '../src/claude/tools/registry.ts'
import { DEFAULT_CONSENTS } from '../src/inventory/privacy.ts'
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
  // notify.notify è valido ma generico: avviso, non errore.
  const generic = checkAutomation({ ...base, actions: [{ action: 'notify.notify', data: { message: 'ciao' } }] }, ctxFrom())
  assert.deepEqual(generic.errors, [])
  assert.match(generic.warnings.join(), /notify\.notify invia al servizio di notifica predefinito/)
  assert.deepEqual(checkAutomation({ ...base, actions: [{ action: 'notify.mobile_app_telefono_di_demo', data: { message: 'ciao' } }] }, ctxFrom()).warnings, [])

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

async function setup(opts: { initial?: Record<string, any>; scripts?: Record<string, any>; helpers?: Record<string, Record<string, any>> } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'assistente-bozze-'))
  const ha = fakeHA()
  const states = await ha.states()
  const writer = fakeWriter(states, opts.initial ?? { '1700000000001': (({ id: _id, ...rest }) => rest)(AUTOMATION_CONFIG) }, { scripts: opts.scripts, helpers: opts.helpers })
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
    assert.equal(p.draft.parts[0]!.kind, 'create')
    assert.equal(p.draft.checks.every((c) => c.ok), true)
    assert.equal(t.writer.calls.filter((c) => c.startsWith('save')).length, 0, 'proporre non scrive nulla')
    const vc = t.ha.calls.find((c) => c.type === 'validate_config')!
    assert.ok(vc.triggers && vc.actions && !('conditions' in vc))

    const applied = await t.service.apply(p.draft.id, { enabled: false, confirmCritical: false, by: 'Admin Demo' })
    assert.equal(applied.status, 'applied')
    const a = applied.parts[0]!.applied!
    assert.equal(a.entityId, 'automation.spegni_lampada_senza_presenza')
    assert.equal(t.writer.files.get(a.key)!.id, a.key)
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
    assert.equal(t.writer.files.has(a.key), false)
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
    const part = p.draft.parts[0]!
    assert.equal(part.kind, 'update')
    assert.ok(part.diff!.some((l) => l.op === '+' && l.line === 'mode: restart'))
    assert.ok(part.diff!.some((l) => l.op === '-' && l.line === 'mode: single'))

    // Modificata da qualcun altro dopo la proposta → rifiuto
    t.writer.externalEdit('1700000000001', { description: 'cambiata a mano' })
    await assert.rejects(t.service.apply(p.draft.id, { enabled: true, confirmCritical: false, by: 'x' }), (e: unknown) => e instanceof DraftError && e.code === 'modificata_nel_frattempo')
    t.writer.externalEdit('1700000000001', { description: current.description })

    const applied = await t.service.apply(p.draft.id, { enabled: true, confirmCritical: false, by: 'x' })
    assert.equal(t.writer.files.get('1700000000001')!.mode, 'restart')
    const backup = JSON.parse(await readFile(applied.parts[0]!.applied!.backupFile!, 'utf8'))
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

// --- Script e helper (0.8) ----------------------------------------------------------------

test('script: forma di scripts.yaml, actions → sequence, campi e chiavi controllati', () => {
  const r = normalizeScript(parseYaml(`attiva_ospiti:
  alias: Attiva ospiti
  sequence:
    - service: light.turn_on
      target: { entity_id: light.lampada_arco }
`).value)
  assert.deepEqual(r.errors, [])
  assert.deepEqual(Object.keys(r.config!), ['alias', 'mode', 'sequence'])
  assert.equal((r.config!.sequence as any[])[0].action, 'light.turn_on')
  assert.ok(r.fixes.some((f) => f.includes('attiva_ospiti')))
  assert.match(r.warnings.join(), /description/)
  const a = normalizeScript({ alias: 'x', actions: [{ action: 'light.turn_off' }] })
  assert.ok(a.config && a.fixes.some((f) => f.includes('sequence')))
  assert.match(normalizeScript({ sequence: [{ action: 'light.turn_off' }] }).errors.join(), /alias/)
  assert.match(normalizeScript({ alias: 'x', sequence: [] }).errors.join(), /almeno un'azione/)
  assert.match(normalizeScript({ alias: 'x', sequence: [{ delay: 1 }], fields: { 'Nome Campo': {} } }).errors.join(), /minuscole/)
  assert.match(normalizeScript({ alias: 'x', sequence: [{ delay: 1 }], trigger: [] }).errors.join(), /Chiavi non ammesse/)
})

test('helper: dominio unico, campi per tipo, valori predefiniti di Home Assistant', () => {
  assert.match(normalizeHelper({ template: { name: 'x' } }).errors.join(), /non è un helper/)
  assert.match(normalizeHelper({ input_boolean: { name: 'a' }, input_number: {} }).errors.join(), /una sola chiave/)
  assert.match(normalizeHelper({ input_boolean: { icon: 'mdi:x' } }).errors.join(), /name/)
  const n = normalizeHelper({ input_number: { name: 'Soglia luce', min: '10', max: 500, id: 'x' } })
  assert.deepEqual(n.config, { name: 'Soglia luce', min: 10, max: 500, step: 1, mode: 'slider' })
  assert.ok(n.fixes.some((f) => f.includes('id')))
  assert.match(normalizeHelper({ input_number: { name: 'x', min: 5, max: 5 } }).errors.join(), /minore/)
  const sel = normalizeHelper({ input_select: { name: 'Modo', options: ['Normale', 2] } })
  assert.deepEqual(sel.config!.options, ['Normale', '2'])
  assert.match(normalizeHelper({ input_select: { name: 'Modo', options: ['a', 'a'] } }).errors.join(), /doppioni/)
  assert.match(normalizeHelper({ input_select: { name: 'Modo', options: ['a'], initial: 'b' } }).errors.join(), /initial/)
  assert.match(normalizeHelper({ input_datetime: { name: 'Sveglia' } }).errors.join(), /has_date/)
  assert.equal(normalizeHelper({ timer: { name: 'Timer', duration: 300 } }).config!.duration, '0:05:00')
  assert.match(normalizeHelper({ schedule: { name: 'Orari', monday: [{ from: '08:00', to: '12:00' }, { from: '11:00', to: '13:00' }] } }).errors.join(), /sovrappongono/)
  assert.deepEqual(normalizeHelper({ schedule: { name: 'Orari', monday: [{ from: '08:00', to: '12:00' }] } }).config!.monday, [{ from: '08:00:00', to: '12:00:00' }])
  assert.match(normalizeHelper({ counter: { name: 'Caffè', minimum: 5, maximum: 1 } }).errors.join(), /minimum/)
})

const SCRIPT_YAML = `alias: Attiva ospiti
description: Accende la modalità ospiti e la lampada
sequence:
  - action: input_boolean.turn_on
    target:
      entity_id: input_boolean.modalita_ospiti
  - action: light.turn_on
    target:
      entity_id: light.lampada_arco
`
const HELPER_YAML = `input_boolean:
  name: Modalità ospiti
  icon: mdi:account-group
`
const AUTO_YAML = `alias: Ospiti la sera
description: Al tramonto, con la modalità ospiti attiva, esegue lo script
triggers:
  - trigger: state
    entity_id: input_boolean.modalita_ospiti
    to: "on"
actions:
  - action: script.attiva_ospiti
`

test('script nuovo: chiave dall\'alias, categoria "Claude" degli script, Annulla lo elimina', async () => {
  const t = await setup()
  try {
    const yaml = SCRIPT_YAML.replace(/  - action: input_boolean[\s\S]*?modalita_ospiti\n/, '')
    const p = await t.service.proposeParts({ elementi: [{ tipo: 'script', yaml }], spiegazione: 'Accende la lampada.' }, t.call)
    assert.equal(p.ok, true, p.ok ? '' : p.errors.join())
    if (!p.ok) return
    const part = p.draft.parts[0]!
    assert.deepEqual([part.object, part.kind, part.key, part.entityId], ['script', 'create', 'attiva_ospiti', 'script.attiva_ospiti'])
    assert.ok(p.draft.checks.some((c) => c.label === 'Nomi liberi' && c.detail === 'script.attiva_ospiti'))
    const vc = t.ha.calls.filter((c) => c.type === 'validate_config').at(-1)!
    assert.ok(vc.actions && !('triggers' in vc), 'per gli script si validano solo le azioni')

    const d = await t.service.apply(p.draft.id, { enabled: true, confirmCritical: false, by: 'Demo' })
    assert.equal(d.parts[0]!.applied!.entityId, 'script.attiva_ospiti')
    assert.equal(t.writer.scripts.get('attiva_ospiti')!.alias, 'Attiva ospiti')
    assert.equal(t.writer.entityCategory.get('script.attiva_ospiti'), 'cat_script_claude')
    const ev = (await t.conversations.get('cprova00000001'))!.lines.filter((l) => l.type === 'event')
    assert.match((ev[0] as any).text, /creato lo script "Attiva ospiti" \(script\.attiva_ospiti\)/)
    assert.equal((await t.store.history())[0]!.object, 'script')

    // Un secondo script con lo stesso alias: chiave occupata.
    const again = await t.service.proposeParts({ elementi: [{ tipo: 'script', yaml }], spiegazione: 'x' }, t.call)
    assert.equal(again.ok, false)
    if (!again.ok) assert.match(again.errors.join(), /Esiste già uno script con chiave attiva_ospiti/)

    await t.service.undo(p.draft.id, { force: false, by: 'Demo' })
    assert.equal(t.writer.scripts.has('attiva_ospiti'), false)
    assert.equal(t.states.has('script.attiva_ospiti'), false)
  } finally {
    await rm(t.dir, { recursive: true, force: true })
  }
})

test('script esistente: modifica con diff, conflitto, script fuori da scripts.yaml in sola lettura', async () => {
  const t = await setup({ scripts: { notte: { alias: 'Notte', sequence: [{ action: 'light.turn_off', target: { entity_id: 'light.lampada_arco' } }], mode: 'single' } } })
  try {
    const yaml = toYaml({ alias: 'Notte', description: 'Spegne tutto', sequence: [{ action: 'light.turn_off', target: { entity_id: 'light.lampada_arco' } }], mode: 'restart' })
    const p = await t.service.proposeParts({ elementi: [{ tipo: 'script', yaml, sostituisce: 'script.notte' }], spiegazione: 'x' }, t.call)
    assert.equal(p.ok, true, p.ok ? '' : p.errors.join())
    if (!p.ok) return
    assert.ok(p.draft.parts[0]!.diff!.some((l) => l.op === '+' && l.line === 'mode: restart'))
    t.writer.externalScriptEdit('notte', { icon: 'mdi:weather-night' })
    await assert.rejects(t.service.apply(p.draft.id, { enabled: true, confirmCritical: false, by: 'x' }), (e: unknown) => e instanceof DraftError && e.code === 'modificata_nel_frattempo')
    const { icon: _icon, ...orig } = t.writer.scripts.get('notte')!
    t.writer.scripts.set('notte', orig)
    const d = await t.service.apply(p.draft.id, { enabled: true, confirmCritical: false, by: 'x' })
    assert.equal(t.writer.scripts.get('notte')!.mode, 'restart')
    assert.equal(t.writer.entityCategory.size, 0, 'nelle modifiche la categoria non si tocca')
    assert.match(d.parts[0]!.applied!.backupFile!, /backups\/scripts\/notte\//)
    await t.service.undo(p.draft.id, { force: false, by: 'x' })
    assert.equal(t.writer.scripts.get('notte')!.mode, 'single')

    const yamlOnly = await t.service.proposeParts({ elementi: [{ tipo: 'script', yaml, sostituisce: 'script.inesistente' }], spiegazione: 'x' }, t.call)
    assert.equal(yamlOnly.ok, false)
  } finally {
    await rm(t.dir, { recursive: true, force: true })
  }
})

test('helper: nuovo con nome libero, modifica con avviso su chi usa le opzioni tolte, YAML in sola lettura', async () => {
  const t = await setup({ helpers: { input_select: { modalita_casa: { name: 'Modalità casa', options: ['Normale', 'Ospiti', 'Vacanza'], icon: 'mdi:home' } } } })
  const call = t.ha.call.bind(t.ha)
  t.ha.call = (async (msg: any) => {
    if (msg.type === 'search/related' && msg.item_id === 'input_select.modalita_casa') return { automation: ['automation.luci_sera'] }
    if (msg.type === 'automation/config' && msg.entity_id === 'automation.luci_sera') return { config: { ...AUTOMATION_CONFIG, conditions: [{ condition: 'state', entity_id: 'input_select.modalita_casa', state: 'Vacanza' }] } }
    return call(msg)
  }) as typeof t.ha.call
  try {
    const taken = await t.service.proposeParts({ elementi: [{ tipo: 'helper', yaml: 'input_boolean:\n  name: Ospiti\n' }], spiegazione: 'x' }, t.call)
    assert.equal(taken.ok, false)
    if (!taken.ok) assert.match(taken.errors.join(), /Esiste già input_boolean\.ospiti/)
    const yamlHelper = await t.service.proposeParts({ elementi: [{ tipo: 'helper', yaml: 'input_boolean:\n  name: Ospiti presenti\n', sostituisce: 'input_boolean.ospiti' }], spiegazione: 'x' }, t.call)
    assert.equal(yamlHelper.ok, false)
    if (!yamlHelper.ok) assert.match(yamlHelper.errors.join(), /definito in YAML/)

    const created = await t.service.proposeParts({ elementi: [{ tipo: 'helper', yaml: 'input_number:\n  name: Soglia luce\n  min: 0\n  max: 1000\n  unit_of_measurement: lx\n' }], spiegazione: 'Soglia regolabile.' }, t.call)
    assert.equal(created.ok, true, created.ok ? '' : created.errors.join())
    if (!created.ok) return
    const cd = await t.service.apply(created.draft.id, { enabled: true, confirmCritical: false, by: 'x' })
    assert.equal(cd.parts[0]!.applied!.entityId, 'input_number.soglia_luce')
    assert.equal(t.writer.entityCategory.get('input_number.soglia_luce'), 'cat_helpers_claude')
    assert.deepEqual(publicDraft(cd).parts[0], { object: 'helper', domain: 'input_number', kind: 'create', alias: 'Soglia luce', yaml: cd.parts[0]!.yaml, diff: null, entityId: 'input_number.soglia_luce', key: 'soglia_luce', enabled: null })

    const p = await t.service.proposeParts(
      { elementi: [{ tipo: 'helper', yaml: 'input_select:\n  name: Modalità casa\n  icon: mdi:home\n  options: [Normale, Ospiti]\n', sostituisce: 'input_select.modalita_casa' }], spiegazione: 'Tolgo Vacanza.' },
      t.call,
    )
    assert.equal(p.ok, true, p.ok ? '' : p.errors.join())
    if (!p.ok) return
    assert.ok(p.draft.warnings.some((w) => /usato da automation\.luci_sera/.test(w)))
    assert.ok(p.draft.warnings.some((w) => /automation\.luci_sera usa l'opzione "Vacanza"/.test(w)))
    assert.ok(p.draft.parts[0]!.diff!.some((l) => l.op === '-' && l.line.includes('Vacanza')))
    await t.service.apply(p.draft.id, { enabled: true, confirmCritical: false, by: 'x' })
    assert.deepEqual(t.writer.helpers.get('input_select')!.get('modalita_casa')!.options, ['Normale', 'Ospiti'])
    await t.service.undo(p.draft.id, { force: false, by: 'x' })
    assert.deepEqual(t.writer.helpers.get('input_select')!.get('modalita_casa')!.options, ['Normale', 'Ospiti', 'Vacanza'])
  } finally {
    await rm(t.dir, { recursive: true, force: true })
  }
})

test('pacchetto: helper + script + automazione con un tap, nell\'ordine giusto, Annulla tutto al contrario', async () => {
  const t = await setup()
  try {
    // L'automazione arriva per prima: il server riordina (helper, script, automazione).
    const p = await t.service.proposeParts(
      { elementi: [{ tipo: 'automazione', yaml: AUTO_YAML }, { tipo: 'script', yaml: SCRIPT_YAML }, { tipo: 'helper', yaml: HELPER_YAML }], spiegazione: 'Modalità ospiti completa.' },
      t.call,
    )
    assert.equal(p.ok, true, p.ok ? '' : p.errors.join())
    if (!p.ok) return
    assert.deepEqual(p.draft.parts.map((x) => x.object), ['helper', 'script', 'automation'])
    assert.ok(p.draft.checks.some((c) => c.label === 'Nomi liberi' && c.detail === 'input_boolean.modalita_ospiti, script.attiva_ospiti'))
    assert.equal(t.writer.calls.filter((c) => /^(save|saveScript|createHelper) /.test(c)).length, 0, 'proporre non scrive nulla')

    const d = await t.service.apply(p.draft.id, { enabled: false, confirmCritical: false, by: 'Demo' })
    assert.deepEqual(d.parts.map((x) => x.applied!.entityId), ['input_boolean.modalita_ospiti', 'script.attiva_ospiti', 'automation.ospiti_la_sera'])
    const order = t.writer.calls.filter((c) => /^(save |saveScript|createHelper)/.test(c))
    assert.deepEqual(order.map((c) => c.split(' ')[0]), ['createHelper', 'saveScript', 'save'])
    assert.equal(t.states.get('automation.ospiti_la_sera')!.state, 'off', 'solo l\'automazione creata disattivata')
    assert.equal(d.parts[2]!.applied!.enabled, false)
    const ev = (await t.conversations.get('cprova00000001'))!.lines.filter((l) => l.type === 'event')
    assert.match((ev[0] as any).text, /input_boolean\.modalita_ospiti.*script\.attiva_ospiti.*automation\.ospiti_la_sera.*disattivata/)
    assert.equal((await t.store.history()).filter((h) => h.action === 'creata').length, 3)
    const pub = publicDraft(d)
    assert.equal(pub.alias, 'Ospiti la sera')
    assert.equal(pub.applied!.entityId, 'automation.ospiti_la_sera')

    await t.service.undo(p.draft.id, { force: false, by: 'Demo' })
    assert.equal(t.writer.files.size, 1)
    assert.equal(t.writer.scripts.size, 0)
    assert.equal(t.writer.helpers.get('input_boolean')!.size, 0)
    const removed = t.writer.calls.filter((c) => /^remove/.test(c)).map((c) => c.split(' ')[0])
    assert.deepEqual(removed, ['remove', 'removeScript', 'removeHelper'], 'prima chi usa, poi ciò che è usato')
  } finally {
    await rm(t.dir, { recursive: true, force: true })
  }
})

test('pacchetto: se una parte viene rifiutata, quelle già scritte tornano indietro', async () => {
  const t = await setup()
  try {
    const p = await t.service.proposeParts(
      { elementi: [{ tipo: 'helper', yaml: HELPER_YAML }, { tipo: 'script', yaml: SCRIPT_YAML }, { tipo: 'automazione', yaml: AUTO_YAML.replace('description: Al', 'description: RIFIUTA Al') }], spiegazione: 'x' },
      t.call,
    )
    assert.equal(p.ok, true, p.ok ? '' : p.errors.join())
    if (!p.ok) return
    await assert.rejects(t.service.apply(p.draft.id, { enabled: true, confirmCritical: false, by: 'x' }), (e: unknown) => e instanceof DraftError && e.code === 'scrittura_rifiutata' && /già scritte sono state annullate/.test(e.message))
    assert.equal(t.writer.scripts.size, 0)
    assert.equal(t.writer.helpers.get('input_boolean')!.size, 0)
    assert.equal(t.states.has('input_boolean.modalita_ospiti'), false)
    const d = t.store.get(p.draft.id)!
    assert.equal(d.status, 'pending')
    assert.ok(d.parts.every((x) => !x.applied))
    assert.equal((await t.store.history()).filter((h) => h.action === 'rollback_automatico').length, 2)
  } finally {
    await rm(t.dir, { recursive: true, force: true })
  }
})

test('riferimenti a parti assenti: errore con gli entity_id che la bozza crea davvero', async () => {
  const t = await setup()
  try {
    const p = await t.service.proposeParts(
      { elementi: [{ tipo: 'helper', yaml: HELPER_YAML }, { tipo: 'automazione', yaml: AUTO_YAML.replace(/input_boolean\.modalita_ospiti/, 'input_boolean.ospiti_modalita').replace('script.attiva_ospiti', 'light.turn_on') }], spiegazione: 'x' },
      t.call,
    )
    assert.equal(p.ok, false)
    if (!p.ok) {
      assert.match(p.errors.join('\n'), /Automazione "Ospiti la sera": L'entità input_boolean\.ospiti_modalita non esiste/)
      assert.match(p.errors.join('\n'), /Nella bozza vengono creati: input_boolean\.modalita_ospiti/)
    }
    const dup = await t.service.proposeParts({ elementi: [{ tipo: 'helper', yaml: HELPER_YAML }, { tipo: 'helper', yaml: HELPER_YAML }], spiegazione: 'x' }, t.call)
    assert.equal(dup.ok, false)
  } finally {
    await rm(t.dir, { recursive: true, force: true })
  }
})

test('bozze salvate fino alla 0.7: convertite al caricamento, ancora annullabili', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'assistente-vecchie-'))
  try {
    await mkdir(join(dir, 'drafts'), { recursive: true })
    const legacy = {
      id: 'dlegacy00001', conversationId: 'c1', toolUseId: 'tu_x', createdAt: '2026-10-01T10:00:00.000Z', status: 'applied', kind: 'create', alias: 'Vecchia',
      explanation: 'x', config: { alias: 'Vecchia' }, yaml: 'alias: Vecchia\n', fixes: [], warnings: [], checks: [], critical: [],
      applied: { at: '2026-10-01T10:01:00.000Z', by: 'Demo', automationId: '1759312860000', entityId: 'automation.vecchia', enabled: true, writtenHash: 'h', backupFile: null },
    }
    await writeFile(join(dir, 'drafts', 'dlegacy00001.json'), JSON.stringify(legacy))
    const store = new DraftStore(dir)
    await store.load()
    const d = store.get('dlegacy00001')!
    assert.deepEqual(d.parts[0]!.applied, { key: '1759312860000', entityId: 'automation.vecchia', enabled: true, writtenHash: 'h', backupFile: null })
    assert.deepEqual(d.applied, { at: '2026-10-01T10:01:00.000Z', by: 'Demo' })
    assert.equal(publicDraft(d).applied!.automationId, '1759312860000')
    assert.equal((d as any).kind, undefined)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('leggi_helper e leggi_script: configurazione, modificabilità, chi li usa', async () => {
  const t = await setup({ scripts: { notte: { alias: 'Notte', sequence: [{ action: 'light.turn_off' }] } }, helpers: { input_number: { soglia: { name: 'Soglia', min: 0, max: 100, step: 1, mode: 'slider' } } } })
  try {
    const ctx = { ha: t.ha, consents: () => DEFAULT_CONSENTS, now: () => new Date('2026-10-14T12:00:00Z'), drafts: t.service }
    const h = JSON.parse((await executeTool('leggi_helper', { entity_id: 'input_number.soglia' }, ctx)).content)
    assert.equal(h.modificabile, true)
    assert.deepEqual(h.configurazione, { name: 'Soglia', min: 0, max: 100, step: 1, mode: 'slider' })
    const y = JSON.parse((await executeTool('leggi_helper', { entity_id: 'input_boolean.ospiti' }, ctx)).content)
    assert.equal(y.modificabile, false)
    assert.match(y.motivo, /YAML/)
    const notHelper = await executeTool('leggi_helper', { entity_id: 'light.lampada_arco' }, ctx)
    assert.equal(notHelper.isError, true)
    const s = JSON.parse((await executeTool('leggi_script', { script: 'notte' }, ctx)).content)
    assert.equal(s.entity_id, 'script.notte')
    assert.equal(s.chiave, 'notte')
    assert.equal(s.modificabile, true)
  } finally {
    await rm(t.dir, { recursive: true, force: true })
  }
})

test('proponi_automazione resta eseguibile per le chat aperte prima della 0.8', async () => {
  const t = await setup()
  try {
    const ctx = { ha: t.ha, consents: () => DEFAULT_CONSENTS, now: () => new Date('2026-10-14T12:00:00Z'), drafts: t.service, call: t.call }
    const r = await executeTool('proponi_automazione', { yaml: GOOD, spiegazione: 'x' }, ctx)
    assert.equal(r.isError, false, r.content)
    assert.match(JSON.parse(r.content).tipo, /nuova automazione/)
    const b = await executeTool('proponi_bozza', { elementi: [{ tipo: 'helper', yaml: 'input_boolean:\n  name: Ospiti presenti\n' }], spiegazione: 'x' }, { ...ctx, call: { ...t.call, toolUseId: 'tu_2' } })
    assert.equal(b.isError, false, b.content)
    assert.deepEqual(JSON.parse(b.content).elementi, [{ tipo: 'helper input_boolean', azione: 'creazione', nome: 'Ospiti presenti', entity_id: 'input_boolean.ospiti_presenti' }])
  } finally {
    await rm(t.dir, { recursive: true, force: true })
  }
})
