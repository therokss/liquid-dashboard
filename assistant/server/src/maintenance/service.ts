import { randomBytes } from 'node:crypto'
import type { HAReader } from '../ha/data.ts'
import type { RegistryWriter } from '../ha/writer.ts'
import type { HAState, Registries } from '../ha/types.ts'
import { domainOf } from '../inventory/privacy.ts'
import type { Manifest } from '../devices/catalog.ts'
import { log } from '../log.ts'
import { collectMaintenance, toConfigEntries, type Collected } from './collect.ts'
import { offlineCandidates, runMaintenance } from './rules.ts'
import type { MaintenanceStore } from './store.ts'
import type { Action, Issue, MaintenanceChange, MaintenanceRun } from './types.ts'

// Manutenzione dei dispositivi: controllo gratuito (nessun dato a Claude) e modifiche ai registri
// di Home Assistant con un tocco. Prima di ogni modifica si rilegge lo stato attuale: se nel
// frattempo è cambiato qualcosa la modifica si ferma. "Sposta" e "Disattiva" si annullano;
// le eliminazioni chiedono conferma e non si annullano.

export class MaintenanceError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

export interface MaintenanceServiceDeps {
  store: MaintenanceStore
  ha: HAReader | null
  writer: RegistryWriter | null
  now?: () => Date
  /** Sostituibile nei test. */
  collect?: (ha: HAReader, manifests: Map<string, Manifest>, now: number) => Promise<Collected>
}

const SECURITY_DOMAINS = new Set(['lock', 'alarm_control_panel', 'siren', 'valve'])
const SECURITY_COVERS = new Set(['garage', 'gate', 'door'])
const USED_BY_CONCURRENCY = 8

export interface MaintenanceOverview {
  run: MaintenanceRun | null
  running: boolean
  ignored: Array<{ signature: string; title: string; at: string; by: string }>
  history: MaintenanceChange[]
  canWrite: boolean
}

export class MaintenanceService {
  private readonly manifests = new Map<string, Manifest>()
  private checking: Promise<MaintenanceRun> | null = null
  private writing: Promise<unknown> = Promise.resolve()
  private readonly now: () => Date

  constructor(private readonly deps: MaintenanceServiceDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  overview(): MaintenanceOverview {
    const ignored = this.deps.store.ignored.active()
    const run = this.deps.store.last()
    return {
      run: run ? { ...run, issues: run.issues.filter((i) => !ignored.has(i.signature)) } : null,
      running: this.checking !== null,
      ignored: [...ignored].map(([signature, m]) => ({ signature, ...m })).sort((a, b) => (a.at < b.at ? 1 : -1)),
      history: this.deps.store.history(),
      canWrite: this.deps.writer !== null,
    }
  }

  /** Un controllo alla volta: chi arriva mentre è in corso aspetta lo stesso risultato. */
  check(by: string): Promise<MaintenanceRun> {
    const ha = this.deps.ha
    if (!ha) return Promise.reject(new MaintenanceError(503, 'ha_non_disponibile', 'Home Assistant non è raggiungibile'))
    this.checking ??= this.runCheck(ha, by).finally(() => {
      this.checking = null
    })
    return this.checking
  }

  private async runCheck(ha: HAReader, by: string): Promise<MaintenanceRun> {
    const started = Date.now()
    const now = this.now().getTime()
    const collected = await (this.deps.collect ?? collectMaintenance)(ha, this.manifests, now)
    const result = runMaintenance(collected.input)
    const { registries, states } = collected.input
    for (const issue of result.issues) {
      const critical = issue.device ? securityReason(issue.device.id, registries, states) : null
      if (critical && issue.actions.length) issue.critical = critical
    }
    await this.addUsedBy(ha, result.issues, states)
    const run: MaintenanceRun = {
      id: `m${now.toString(36)}${randomBytes(3).toString('hex')}`,
      createdAt: new Date(now).toISOString(),
      by,
      durationMs: Date.now() - started,
      coverageDays: collected.input.coverageDays,
      ...result,
    }
    await this.deps.store.saveRun(run)
    log.info(`Manutenzione: ${run.issues.length} segnalazioni in ${Math.round(run.durationMs / 100) / 10} s`)
    return run
  }

  /** Automazioni e script che si fermerebbero: solo per le segnalazioni che disattivano o eliminano. */
  private async addUsedBy(ha: HAReader, issues: Issue[], states: Map<string, HAState>): Promise<void> {
    const jobs = issues.filter((i) => i.actions.some((a) => a.type !== 'sposta'))
    const name = (id: string) => {
      const n = states.get(id)?.attributes.friendly_name
      return typeof n === 'string' && n ? n : id
    }
    const related = async (itemType: 'device' | 'entity', itemId: string): Promise<string[]> => {
      try {
        const r = await ha.call<Record<string, unknown>>({ type: 'search/related', item_type: itemType, item_id: itemId })
        return ['automation', 'script'].flatMap((k) => (Array.isArray(r?.[k]) ? (r[k] as unknown[]).filter((x): x is string => typeof x === 'string') : []))
      } catch {
        return []
      }
    }
    for (let i = 0; i < jobs.length; i += USED_BY_CONCURRENCY) {
      await Promise.all(
        jobs.slice(i, i + USED_BY_CONCURRENCY).map(async (issue) => {
          const lists =
            issue.kind === 'orfane'
              ? await Promise.all((issue.entities ?? []).map((e) => related('entity', e)))
              : await Promise.all([...new Set(issue.actions.flatMap((a) => ('deviceId' in a ? [a.deviceId] : [])))].map((d) => related('device', d)))
          const ids = [...new Set(lists.flat())].sort()
          if (ids.length) issue.usedBy = ids.map((entityId) => ({ entityId, name: name(entityId) }))
        }),
      )
    }
  }

  private requireIssue(issueId: string): { run: MaintenanceRun; issue: Issue } {
    const run = this.deps.store.last()
    const issue = run?.issues.find((i) => i.id === issueId)
    if (!run || !issue) throw new MaintenanceError(404, 'segnalazione_inesistente', 'Segnalazione non trovata: ripeti il controllo')
    return { run, issue }
  }

  /** Le scritture passano una alla volta (due tocchi rapidi non si sovrappongono). */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writing.then(fn, fn)
    this.writing = next.catch(() => undefined)
    return next
  }

  apply(issueId: string, actionIndex: number, by: string, confirm: boolean): Promise<MaintenanceChange> {
    return this.serial(async () => {
      const { ha, writer } = this.deps
      if (!ha || !writer) throw new MaintenanceError(503, 'ha_non_disponibile', 'Home Assistant non è raggiungibile')
      const { run, issue } = this.requireIssue(issueId)
      if (issue.applied && !issue.applied.undone) throw new MaintenanceError(409, 'gia_applicata', 'Questa modifica è già stata fatta')
      if (this.deps.store.ignored.active().has(issue.signature)) throw new MaintenanceError(409, 'ignorata', 'Segnalazione ignorata: riattivala prima')
      const action = issue.actions[actionIndex]
      if (!action) throw new MaintenanceError(400, 'azione_non_valida', 'Azione non valida')
      const destructive = action.type === 'elimina_dispositivo' || action.type === 'elimina_entita'
      if ((destructive || issue.critical) && !confirm) {
        throw new MaintenanceError(
          428,
          'conferma_richiesta',
          destructive ? "L'eliminazione non si può annullare: conferma per procedere" : `Il dispositivo ${issue.critical}: conferma per procedere`,
        )
      }

      const [registries, states] = await Promise.all([ha.registries(), ha.states()])
      const change: MaintenanceChange = {
        id: `c${this.now().getTime().toString(36)}${randomBytes(3).toString('hex')}`,
        at: this.now().toISOString(),
        by,
        issueId,
        signature: issue.signature,
        title: issue.title,
        action,
        before: null,
      }
      const device = (id: string) => {
        const d = registries.devices.find((x) => x.id === id)
        if (!d) throw new MaintenanceError(409, 'cambiato', 'Il dispositivo non esiste più: ripeti il controllo')
        return d
      }

      switch (action.type) {
        case 'sposta': {
          const d = device(action.deviceId)
          if (!registries.areas.some((a) => a.area_id === action.areaId)) throw new MaintenanceError(409, 'cambiato', `L'area "${action.areaName}" non esiste più`)
          if (d.area_id === action.areaId) throw new MaintenanceError(409, 'gia_fatto', `È già in ${action.areaName}`)
          if (d.area_id !== action.from) throw new MaintenanceError(409, 'cambiato', "L'area del dispositivo è cambiata dopo il controllo: ripeti il controllo")
          change.before = { area_id: d.area_id }
          await writer.updateDevice(d.id, { area_id: action.areaId })
          break
        }
        case 'disattiva': {
          const d = device(action.deviceId)
          if (d.disabled_by) throw new MaintenanceError(409, 'gia_fatto', 'Il dispositivo è già disattivato')
          change.before = { disabled_by: null }
          await writer.updateDevice(d.id, { disabled_by: 'user' })
          break
        }
        case 'elimina_dispositivo': {
          device(action.deviceId)
          // Solo se è ancora offline adesso: se nel frattempo ha risposto, niente eliminazione.
          const entries = await ha.call<Array<Record<string, unknown>>>({ type: 'config_entries/get' }).catch(() => [])
          const still = offlineCandidates({ now: this.now().getTime(), registries, states, entries: toConfigEntries(Array.isArray(entries) ? entries : []), reauth: [], manifests: this.manifests })
          if (!still.has(action.deviceId)) throw new MaintenanceError(409, 'cambiato', 'Il dispositivo ha risposto dopo il controllo: non lo elimino')
          await writer.removeDevice(action.deviceId, action.configEntryId)
          break
        }
        case 'elimina_entita': {
          const known = new Set(registries.entities.map((e) => e.entity_id))
          const still = action.entityIds.filter((id) => known.has(id) && states.get(id)?.attributes.restored === true)
          if (!still.length) throw new MaintenanceError(409, 'cambiato', "Le entità non sono più da eliminare (già rimosse o di nuovo fornite dall'integrazione)")
          const removed: string[] = []
          for (const id of still) {
            await writer.removeEntity(id)
            removed.push(id)
          }
          change.removed = removed
          break
        }
      }

      await this.deps.store.addChange(change)
      issue.applied = { action: action.type, at: change.at, by, historyId: change.id }
      await this.deps.store.saveRun(run)
      log.info(`Manutenzione: ${action.type} (${issue.signature}) da ${by}`)
      return change
    })
  }

  undo(changeId: string, by: string): Promise<MaintenanceChange> {
    return this.serial(async () => {
      const { ha, writer, store } = this.deps
      if (!ha || !writer) throw new MaintenanceError(503, 'ha_non_disponibile', 'Home Assistant non è raggiungibile')
      const change = store.change(changeId)
      if (!change) throw new MaintenanceError(404, 'modifica_inesistente', 'Modifica non trovata')
      if (change.undone) throw new MaintenanceError(409, 'gia_annullata', 'Modifica già annullata')
      const a = change.action
      if (a.type !== 'sposta' && a.type !== 'disattiva') throw new MaintenanceError(409, 'non_annullabile', "Un'eliminazione non si può annullare")
      const registries = await ha.registries()
      const d = registries.devices.find((x) => x.id === a.deviceId)
      if (!d) throw new MaintenanceError(409, 'cambiato', 'Il dispositivo non esiste più')
      if (a.type === 'sposta') {
        if (d.area_id !== a.areaId) throw new MaintenanceError(409, 'cambiato', "L'area è stata cambiata di nuovo dopo la modifica: non la tocco")
        await writer.updateDevice(d.id, { area_id: change.before?.area_id ?? null })
      } else {
        if (d.disabled_by !== 'user') throw new MaintenanceError(409, 'cambiato', 'Il dispositivo è già stato riattivato')
        await writer.updateDevice(d.id, { disabled_by: null })
      }
      const at = this.now().toISOString()
      await store.markUndone(change.id, at, by)
      const run = store.last()
      const issue = run?.issues.find((i) => i.applied?.historyId === change.id)
      if (run && issue?.applied) {
        issue.applied = { ...issue.applied, undone: true }
        await store.saveRun(run)
      }
      log.info(`Manutenzione: annullato ${a.type} (${change.signature}) da ${by}`)
      return store.change(change.id)!
    })
  }

  async ignore(issueId: string, by: string): Promise<void> {
    const { issue } = this.requireIssue(issueId)
    await this.deps.store.ignored.add(issue.signature, { at: this.now().toISOString(), by, title: issue.title })
  }

  async unignore(signature: string): Promise<boolean> {
    if (!this.deps.store.ignored.active().has(signature)) return false
    await this.deps.store.ignored.remove(signature)
    return true
  }
}

/** Il dispositivo comanda serrature, allarmi, sirene, valvole o un garage/cancello? */
export function securityReason(deviceId: string, registries: Registries, states: Map<string, HAState>): string | null {
  for (const e of registries.entities) {
    if (e.device_id !== deviceId || e.disabled_by) continue
    const domain = domainOf(e.entity_id)
    if (SECURITY_DOMAINS.has(domain)) return 'comanda serrature, allarmi, sirene o valvole'
    const cls = states.get(e.entity_id)?.attributes.device_class
    if (domain === 'cover' && typeof cls === 'string' && SECURITY_COVERS.has(cls)) return 'comanda un garage, un cancello o una porta'
  }
  return null
}
