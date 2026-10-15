import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { READ_TYPES } from '../src/ha/data.ts'
import { collectMaintenance, lastValidEnd, toReauthFlows } from '../src/maintenance/collect.ts'
import { runMaintenance } from '../src/maintenance/rules.ts'
import { MaintenanceError, MaintenanceService } from '../src/maintenance/service.ts'
import { MaintenanceStore } from '../src/maintenance/store.ts'
import type { Issue } from '../src/maintenance/types.ts'
import { D, M_NOW, maintenanceHome } from './fakeMaintenance.ts'

type Json = Record<string, any>
const DAY = 86_400_000
const now = M_NOW.getTime()

async function service() {
  const home = maintenanceHome()
  const dir = await mkdtemp(join(tmpdir(), 'manutenzione-'))
  const store = new MaintenanceStore(dir, () => M_NOW)
  await store.load()
  const svc = new MaintenanceService({ store, ha: home.ha, writer: home.writer, now: () => M_NOW })
  return { ...home, dir, store, svc }
}

const find = (issues: Issue[], kind: Issue['kind'], deviceId?: string) => {
  const i = issues.find((x) => x.kind === kind && (!deviceId || x.device?.id === deviceId))
  assert.ok(i, `manca la segnalazione ${kind} ${deviceId ?? ''}`)
  return i
}

async function rejects(p: Promise<unknown>, status: number, code: string) {
  await assert.rejects(p, (err: unknown) => {
    assert.ok(err instanceof MaintenanceError, String(err))
    assert.equal(err.status, status)
    assert.equal(err.code, code)
    return true
  })
}

test('storico: fine dell\'ultimo stato valido; flussi di riautenticazione', () => {
  const s = (ms: number) => ms / 1000
  assert.equal(lastValidEnd([{ s: 'on', lu: s(now - 5 * DAY) }, { s: 'unavailable', lu: s(now - 2 * DAY) }], now), now - 2 * DAY)
  assert.equal(lastValidEnd([{ s: 'unavailable', lu: s(now - 5 * DAY) }, { s: 'on', lu: s(now - DAY) }], now), now)
  assert.equal(lastValidEnd([{ s: 'unknown', lu: s(now - 5 * DAY) }, { s: 'unavailable', lu: s(now - DAY) }], now), null)
  assert.equal(lastValidEnd([], now), null)
  assert.deepEqual(toReauthFlows([{ handler: 'ring', context: { source: 'reauth', entry_id: 'x' } }, { handler: 'zha', context: { source: 'user' } }]), [{ domain: 'ring', entryId: 'x' }])
})

test('regole: una segnalazione per ogni caso della casa di prova, niente falsi allarmi', async () => {
  const home = maintenanceHome()
  const { input } = await collectMaintenance(home.ha, new Map(), now)
  assert.equal(input.coverageDays, 30)
  const r = runMaintenance(input)
  assert.deepEqual(r.counts, { offline: 2, orfane: 2, stanza: 2, senza_area: 2, doppione: 1, integrazione: 2, batteria: 1, aggiornamento: 1 })
  assert.deepEqual(r.issues.map((i) => i.id), r.issues.map((_, n) => `m${n + 1}`))

  // Offline: il sensore vecchio tace da 60 giorni (dalle statistiche, oltre lo storico), si può eliminare.
  const vecchio = find(r.issues, 'offline', D.vecchio)
  assert.match(vecchio.detail, /60 giorni/)
  assert.deepEqual(vecchio.actions, [{ type: 'disattiva', deviceId: D.vecchio }, { type: 'elimina_dispositivo', deviceId: D.vecchio, configEntryId: 'ce_zha' }])
  assert.deepEqual(vecchio.entities, ['binary_sensor.porta_vecchia'])
  assert.match(find(r.issues, 'offline', D.serratura).detail, /ultimi 30 giorni/)
  // Non sono offline: la presa ha risposto 3 giorni fa; la presa Meross ha l'integrazione in errore.
  assert.ok(!r.issues.some((i) => i.device?.id === D.recente))
  assert.ok(!r.issues.some((i) => i.kind !== 'integrazione' && i.device?.id === D.meross))
  assert.ok(!r.issues.some((i) => i.entities?.includes('switch.presa_meross')))

  // Orfane: raggruppate per dispositivo o per integrazione.
  const orfane = r.issues.filter((i) => i.kind === 'orfane')
  assert.deepEqual(orfane.map((i) => i.entities).sort(), [['sensor.lampada_letto_vecchio_nome'], ['sensor.template_vecchio']])
  assert.deepEqual(find(r.issues, 'orfane', D.letto).actions, [{ type: 'elimina_entita', entityIds: ['sensor.lampada_letto_vecchio_nome'] }])

  // Stanze: dall'app Hue (certa) e dal nome (da verificare, "Camera ospiti" batte "Camera").
  const hue = find(r.issues, 'stanza', D.arco)
  assert.equal(hue.confidence, 'certa')
  assert.deepEqual(hue.actions, [{ type: 'sposta', deviceId: D.arco, areaId: 'cucina', areaName: 'Cucina', from: 'soggiorno' }])
  const ospiti = find(r.issues, 'stanza', D.termostato)
  assert.equal(ospiti.confidence, 'da_verificare')
  assert.equal((ospiti.actions[0] as Json).areaId, 'camera_ospiti')
  assert.ok(!r.issues.some((i) => i.device?.id === D.letto && i.kind === 'stanza'), 'le zone Hue non sono stanze')

  // Senza area: dal nome o dall'area delle entità; gli altri solo in elenco (niente telefoni).
  assert.equal((find(r.issues, 'senza_area', D.garage).actions[0] as Json).areaId, 'garage')
  assert.equal((find(r.issues, 'senza_area', D.rele).actions[0] as Json).areaId, 'cucina')
  assert.deepEqual(r.unassigned.map((d) => d.name), ['Presa smart'])

  // Doppione: si disattiva la parte cloud.
  const doppio = find(r.issues, 'doppione')
  assert.deepEqual(doppio.actions, [{ type: 'disattiva', deviceId: D.tvCloud }])
  assert.equal(doppio.device?.integration, 'Tuya')

  // Integrazioni: Ring una volta sola (riautenticazione), Meross in riprova; quella disattivata no.
  const integr = r.issues.filter((i) => i.kind === 'integrazione')
  assert.deepEqual(integr.map((i) => i.link).sort(), ['/config/integrations/integration/meross_cloud', '/config/integrations/integration/ring'])
  assert.ok(integr.some((i) => /accesso/.test(i.title)))

  // Batteria all'8% (non quella del telefono) e firmware.
  const batt = find(r.issues, 'batteria')
  assert.equal(batt.device?.id, D.porta)
  assert.equal(batt.severity, 'avviso')
  assert.equal(batt.title, "Sensore porta ingresso: batteria all'8%")
  assert.match(batt.signature, /:2026-10$/)
  assert.equal(find(r.issues, 'aggiornamento').signature, 'aggiornamento:update.lavatrice_firmware:1.7.0')
})

test('regole: con poco storico si dice quanto, sotto la soglia minima si tace', async () => {
  const sunFrom = (days: number) => [{ s: 'above_horizon', lu: (now - days * DAY) / 1000 }]
  const at = async (days: number) => {
    const h = maintenanceHome()
    // Il recorder arriva indietro solo di `days` giorni.
    const call = h.ha.call.bind(h.ha)
    h.ha.call = (async (msg: Json) => {
      if (msg.type === 'history/history_during_period' && (msg.entity_ids as string[]).includes('sun.sun')) return { 'sun.sun': sunFrom(days) }
      return call(msg)
    }) as typeof h.ha.call
    return runMaintenance((await collectMaintenance(h.ha, new Map(), now)).input)
  }
  const ten = await at(10)
  assert.match(find(ten.issues, 'offline', D.serratura).detail, /10 giorni: il recorder non va più indietro/)
  assert.ok(find(ten.issues, 'offline', D.vecchio), 'le statistiche bastano anche con poco storico')
  const three = await at(3)
  assert.ok(!three.issues.some((i) => i.device?.id === D.serratura))
})

test('servizio: controllo gratuito in sola lettura, automazioni collegate, conferme', async () => {
  const { svc, ha, writes } = await service()
  const run = await svc.check('Demo')
  assert.equal(run.issues.length, 13)
  // Solo comandi di lettura, nessuna scrittura.
  for (const c of ha.calls) assert.ok(READ_TYPES.has(String(c.type)), `comando non di lettura: ${c.type}`)
  assert.deepEqual(writes, [])

  const vecchio = find(run.issues, 'offline', D.vecchio)
  assert.deepEqual(vecchio.usedBy, [{ entityId: 'automation.avviso_porta', name: 'automation.avviso_porta' }])
  assert.deepEqual(find(run.issues, 'orfane', D.letto).usedBy?.map((u) => u.entityId), ['automation.luci_notte'])
  assert.equal(find(run.issues, 'stanza', D.arco).usedBy, undefined)
  const serratura = find(run.issues, 'offline', D.serratura)
  assert.match(serratura.critical ?? '', /serrature/)

  // Eliminazioni e dispositivi di sicurezza: senza conferma no.
  await rejects(svc.apply(vecchio.id, 1, 'Demo', false), 428, 'conferma_richiesta')
  await rejects(svc.apply(serratura.id, 0, 'Demo', false), 428, 'conferma_richiesta')
  await rejects(svc.apply(find(run.issues, 'orfane', D.letto).id, 0, 'Demo', false), 428, 'conferma_richiesta')
  await rejects(svc.apply('m999', 0, 'Demo', true), 404, 'segnalazione_inesistente')
  await rejects(svc.apply(vecchio.id, 7, 'Demo', true), 400, 'azione_non_valida')
  assert.deepEqual(writes, [])
})

test('servizio: sposta e disattiva con un tocco e Annulla; eliminazioni; cambi nel frattempo', async () => {
  const { svc, writes, registries, store, dir } = await service()
  const run = await svc.check('Demo')

  // Sposta (Hue) → Annulla.
  const hue = find(run.issues, 'stanza', D.arco)
  const moved = await svc.apply(hue.id, 0, 'Demo', false)
  assert.deepEqual(writes.at(-1), { op: 'update', deviceId: D.arco, area_id: 'cucina' })
  assert.deepEqual(moved.before, { area_id: 'soggiorno' })
  assert.equal(svc.overview().run?.issues.find((i) => i.id === hue.id)?.applied?.historyId, moved.id)
  await rejects(svc.apply(hue.id, 0, 'Demo', false), 409, 'gia_applicata')
  await svc.undo(moved.id, 'Demo')
  assert.deepEqual(writes.at(-1), { op: 'update', deviceId: D.arco, area_id: 'soggiorno' })
  assert.equal(svc.overview().run?.issues.find((i) => i.id === hue.id)?.applied?.undone, true)
  await rejects(svc.undo(moved.id, 'Demo'), 409, 'gia_annullata')

  // Disattiva → Annulla; poi elimina (con conferma) perché è ancora offline.
  const vecchio = find(run.issues, 'offline', D.vecchio)
  const off = await svc.apply(vecchio.id, 0, 'Demo', false)
  assert.deepEqual(writes.at(-1), { op: 'update', deviceId: D.vecchio, disabled_by: 'user' })
  await svc.undo(off.id, 'Demo')
  assert.deepEqual(writes.at(-1), { op: 'update', deviceId: D.vecchio, disabled_by: null })
  const gone = await svc.apply(vecchio.id, 1, 'Demo', true)
  assert.deepEqual(writes.at(-1), { op: 'removeDevice', deviceId: D.vecchio, configEntryId: 'ce_zha' })
  await rejects(svc.undo(gone.id, 'Demo'), 409, 'non_annullabile')

  // Entità orfane (con conferma).
  const orfane = find(run.issues, 'orfane', D.letto)
  const removed = await svc.apply(orfane.id, 0, 'Demo', true)
  assert.deepEqual(removed.removed, ['sensor.lampada_letto_vecchio_nome'])
  assert.deepEqual(writes.at(-1), { op: 'removeEntity', entityId: 'sensor.lampada_letto_vecchio_nome' })

  // L'area è cambiata dopo il controllo: niente modifica.
  registries.devices.find((d) => d.id === D.garage)!.area_id = 'soggiorno'
  const n = writes.length
  await rejects(svc.apply(find(run.issues, 'senza_area', D.garage).id, 0, 'Demo', false), 409, 'cambiato')
  // Annulla di uno spostamento rifatto a mano: non si tocca.
  const ospiti = await svc.apply(find(run.issues, 'stanza', D.termostato).id, 0, 'Demo', false)
  registries.devices.find((d) => d.id === D.termostato)!.area_id = 'camera'
  await rejects(svc.undo(ospiti.id, 'Demo'), 409, 'cambiato')
  assert.equal(writes.length, n + 1)

  // Ignora / riattiva.
  const doppio = find(run.issues, 'doppione')
  await svc.ignore(doppio.id, 'Demo')
  assert.ok(!svc.overview().run?.issues.some((i) => i.id === doppio.id))
  assert.equal(svc.overview().ignored[0]?.signature, doppio.signature)
  await rejects(svc.apply(doppio.id, 0, 'Demo', false), 409, 'ignorata')
  assert.equal(await svc.unignore(doppio.signature), true)
  assert.ok(svc.overview().run?.issues.some((i) => i.id === doppio.id))

  // Tutto persiste: ultimo controllo, modifiche e annullamenti.
  const again = new MaintenanceStore(dir)
  await again.load()
  assert.equal(again.last()?.issues.length, 13)
  const hist = again.history()
  assert.equal(hist.length, 5)
  assert.ok(hist.find((c) => c.id === moved.id)?.undone)
  assert.ok(!hist.find((c) => c.id === gone.id)?.undone)
  assert.deepEqual(store.history().map((c) => c.id), hist.map((c) => c.id))
})
