import type { HAConnection } from '../ha/connection.ts'
import type { HARest } from '../ha/rest.ts'
import type { Mode } from '../ha/env.ts'

// Diagnostica della Fase 0: verifica dal vivo che il token dell'add-on possa usare tutte le
// API su cui si basano le fasi successive. Solo LETTURA: ogni comando WebSocket passa da
// un elenco chiuso; qualunque altro tipo viene rifiutato prima di partire.

export const READ_ONLY_WS_TYPES = new Set([
  'get_config',
  'get_states',
  'get_services',
  'config/auth/list',
  'config/entity_registry/list_for_display',
  'config/device_registry/list',
  'config/area_registry/list',
  'config/label_registry/list',
  'config/category_registry/list',
  'validate_config',
  'automation/config',
  'trace/list',
  'search/related',
  'logbook/get_events',
  'history/history_during_period',
  'recorder/list_statistic_ids',
  'recorder/statistics_during_period',
  'trigger_platforms/subscribe',
  'unsubscribe_events',
  'manifest/get',
  'ping',
])

type Json = Record<string, unknown>

export interface ReadOnlyHA {
  call<T = unknown>(msg: Json, timeoutMs?: number): Promise<T>
  subscribeOnce(msg: Json, waitMs: number): Promise<unknown>
}

export function readOnly(conn: Pick<HAConnection, 'sendMessage' | 'subscribe'>): ReadOnlyHA {
  const guard = (msg: Json) => {
    if (!READ_ONLY_WS_TYPES.has(String(msg.type))) {
      throw new Error(`Comando non ammesso in diagnostica: ${String(msg.type)}`)
    }
  }
  return {
    call<T>(msg: Json, timeoutMs?: number) {
      guard(msg)
      return conn.sendMessage<T>(msg, timeoutMs)
    },
    async subscribeOnce(msg: Json, waitMs: number) {
      guard(msg)
      let first: unknown = undefined
      let got!: () => void
      const arrived = new Promise<void>((r) => (got = r))
      const unsubscribe = await conn.subscribe(msg, (ev) => {
        if (first === undefined) {
          first = ev
          got()
        }
      })
      let timer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([arrived, new Promise((r) => (timer = setTimeout(r, waitMs)))])
      clearTimeout(timer)
      await unsubscribe()
      return first
    },
  }
}

export type ProbeStatus = 'ok' | 'avviso' | 'errore' | 'saltata'

export interface ProbeResult {
  id: string
  label: string
  status: ProbeStatus
  summary: string
  ms: number
  details?: unknown
}

interface ProbeContext {
  ha: ReadOnlyHA | null
  rest: HARest
  mode: Mode
  /** Dati raccolti da probe precedenti (es. un'automazione da usare negli altri test). */
  shared: { automationEntity?: string; automationId?: string; statisticId?: string }
}

interface Probe {
  id: string
  label: string
  needsHA: boolean
  run(ctx: ProbeContext): Promise<Omit<ProbeResult, 'id' | 'label' | 'ms'>>
}

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString()
const HOUR = 3_600_000

function ok(summary: string, details?: unknown) {
  return { status: 'ok' as const, summary, details }
}

const PROBES: Probe[] = [
  {
    id: 'rest_ping',
    label: 'API REST di Home Assistant',
    needsHA: false,
    async run({ rest, mode }) {
      if (mode === 'none') return { status: 'saltata', summary: 'Nessun Home Assistant configurato (modalità sviluppo senza HA_URL)' }
      const r = await rest.get<{ message?: string }>('/')
      return r.ok ? ok(`Risposta: ${r.data?.message ?? r.status}`) : { status: 'errore', summary: `HTTP ${r.status}` }
    },
  },
  {
    id: 'get_config',
    label: 'Connessione WebSocket e versione',
    needsHA: true,
    async run({ ha }) {
      const cfg = await ha!.call<{ version: string; location_name: string; time_zone: string; components: string[] }>({ type: 'get_config' })
      return ok(`Home Assistant ${cfg.version}, fuso ${cfg.time_zone}`, { integrazioni_caricate: cfg.components.length })
    },
  },
  {
    id: 'auth_list',
    label: 'Elenco utenti (permesso admin del token)',
    needsHA: true,
    async run({ ha }) {
      const users = await ha!.call<Array<{ is_owner?: boolean; group_ids?: string[]; system_generated?: boolean }>>({ type: 'config/auth/list' })
      const admins = users.filter((u) => u.is_owner || (u.group_ids ?? []).includes('system-admin')).length
      return ok(`${users.length} utenti, ${admins} amministratori`)
    },
  },
  {
    id: 'registries',
    label: 'Registri: entità, dispositivi, aree, label',
    needsHA: true,
    async run({ ha }) {
      const [ents, devs, areas, labels] = await Promise.all([
        ha!.call<{ entities: unknown[] }>({ type: 'config/entity_registry/list_for_display' }),
        ha!.call<unknown[]>({ type: 'config/device_registry/list' }),
        ha!.call<unknown[]>({ type: 'config/area_registry/list' }),
        ha!.call<unknown[]>({ type: 'config/label_registry/list' }),
      ])
      return ok(`${ents.entities.length} entità, ${devs.length} dispositivi, ${areas.length} aree, ${labels.length} label`)
    },
  },
  {
    id: 'categories',
    label: 'Categorie delle automazioni',
    needsHA: true,
    async run({ ha }) {
      const cats = await ha!.call<Array<{ name: string }>>({ type: 'config/category_registry/list', scope: 'automation' })
      return ok(`${cats.length} categorie: ${cats.map((c) => c.name).join(', ') || '—'}`)
    },
  },
  {
    id: 'states_services',
    label: 'Stati e servizi',
    needsHA: true,
    async run({ ha, shared }) {
      const [states, services] = await Promise.all([
        ha!.call<Array<{ entity_id: string; attributes: Record<string, unknown> }>>({ type: 'get_states' }),
        ha!.call<Record<string, Record<string, unknown>>>({ type: 'get_services' }),
      ])
      const autos = states.filter((s) => s.entity_id.startsWith('automation.') && s.attributes.id)
      const first = autos[0]
      if (first) {
        shared.automationEntity = first.entity_id
        shared.automationId = String(first.attributes.id)
      }
      const serviceCount = Object.values(services).reduce((n, d) => n + Object.keys(d).length, 0)
      return ok(`${states.length} stati, ${autos.length} automazioni con id, ${serviceCount} servizi`)
    },
  },
  {
    id: 'validate_plural',
    label: 'validate_config (sintassi attuale)',
    needsHA: true,
    async run({ ha }) {
      const r = await ha!.call<Record<string, { valid: boolean; error: string | null }>>({
        type: 'validate_config',
        triggers: [{ trigger: 'state', entity_id: 'sun.sun', to: 'below_horizon' }],
        conditions: [{ condition: 'state', entity_id: 'sun.sun', state: 'below_horizon' }],
        actions: [{ delay: { seconds: 1 } }],
      })
      const bad = Object.entries(r).filter(([, v]) => !v.valid)
      return bad.length === 0
        ? ok('Trigger, condizioni e azioni riconosciuti', r)
        : { status: 'errore', summary: bad.map(([k, v]) => `${k}: ${v.error}`).join('; '), details: r }
    },
  },
  {
    id: 'validate_legacy',
    label: 'validate_config (sintassi vecchia platform/service)',
    needsHA: true,
    async run({ ha }) {
      // Solo informativo: dice se HA accetta ancora platform:/service: dentro le chiavi plurali.
      const r = await ha!.call<Record<string, { valid: boolean; error: string | null }>>({
        type: 'validate_config',
        triggers: [{ platform: 'state', entity_id: 'sun.sun' }],
        actions: [{ service: 'homeassistant.update_entity', target: { entity_id: 'sun.sun' } }],
      })
      const verdict = Object.entries(r).map(([k, v]) => `${k}: ${v.valid ? 'accettata' : 'rifiutata'}`).join(', ')
      return { status: 'ok', summary: verdict, details: r }
    },
  },
  {
    id: 'automation_rest',
    label: "Lettura di un'automazione via REST (stessa API della scrittura)",
    needsHA: true,
    async run({ rest, shared }) {
      if (!shared.automationId) return { status: 'saltata', summary: 'Nessuna automazione con id trovata' }
      const r = await rest.get<{ alias?: string }>(`/config/automation/config/${encodeURIComponent(shared.automationId)}`)
      return r.ok
        ? ok(`Letta "${r.data?.alias ?? shared.automationId}"`)
        : { status: 'errore', summary: `HTTP ${r.status}: il token non può usare /api/config/automation` }
    },
  },
  {
    id: 'automation_ws',
    label: 'automation/config e search/related',
    needsHA: true,
    async run({ ha, shared }) {
      if (!shared.automationEntity) return { status: 'saltata', summary: 'Nessuna automazione trovata' }
      const [cfg, related] = await Promise.all([
        ha!.call<{ config: { alias?: string } }>({ type: 'automation/config', entity_id: shared.automationEntity }),
        ha!.call<Record<string, string[]>>({ type: 'search/related', item_type: 'automation', item_id: shared.automationEntity }),
      ])
      const counts = Object.entries(related).map(([k, v]) => `${k} ${v.length}`).join(', ')
      return ok(`"${cfg.config.alias ?? shared.automationEntity}": ${counts || 'nessun riferimento'}`)
    },
  },
  {
    id: 'traces',
    label: 'Tracce delle automazioni',
    needsHA: true,
    async run({ ha }) {
      const traces = await ha!.call<Array<{ item_id: string; state: string; script_execution: string | null }>>({ type: 'trace/list', domain: 'automation' })
      const items = new Set(traces.map((t) => t.item_id)).size
      const errors = traces.filter((t) => t.script_execution === 'error').length
      return ok(`${traces.length} tracce su ${items} automazioni, ${errors} in errore`)
    },
  },
  {
    id: 'logbook',
    label: "Registro attività (ultima ora) e cause delle azioni",
    needsHA: true,
    async run({ ha }) {
      const events = await ha!.call<Array<Record<string, unknown>>>(
        { type: 'logbook/get_events', start_time: iso(HOUR), end_time: iso(0) },
        60_000,
      )
      const byUser = events.filter((e) => e.context_user_id).length
      const byAutomation = events.filter((e) => e.context_event_type === 'automation_triggered' || e.context_domain === 'automation').length
      return ok(`${events.length} voci: ${byUser} da utenti, ${byAutomation} da automazioni`)
    },
  },
  {
    id: 'history',
    label: 'Storico degli stati',
    needsHA: true,
    async run({ ha }) {
      const r = await ha!.call<Record<string, unknown[]>>({
        type: 'history/history_during_period',
        start_time: iso(24 * HOUR),
        entity_ids: ['sun.sun'],
        minimal_response: true,
        no_attributes: true,
      })
      return ok(`sun.sun: ${r['sun.sun']?.length ?? 0} cambi nelle ultime 24 h`)
    },
  },
  {
    id: 'statistics',
    label: 'Statistiche a lungo termine',
    needsHA: true,
    async run({ ha, shared }) {
      const ids = await ha!.call<Array<{ statistic_id: string }>>({ type: 'recorder/list_statistic_ids', statistic_type: 'mean' }, 60_000)
      const first = ids.find((s) => s.statistic_id.startsWith('sensor.'))
      if (!first) return { status: 'avviso', summary: 'Nessuna statistica di tipo media' }
      shared.statisticId = first.statistic_id
      const r = await ha!.call<Record<string, unknown[]>>({
        type: 'recorder/statistics_during_period',
        start_time: iso(7 * 24 * HOUR),
        statistic_ids: [first.statistic_id],
        period: 'day',
        types: ['mean', 'min', 'max'],
      })
      return ok(`${ids.length} sensori con statistiche; ${first.statistic_id}: ${r[first.statistic_id]?.length ?? 0} giorni`)
    },
  },
  {
    id: 'trigger_catalog',
    label: 'Catalogo dei trigger (sottoscrizione)',
    needsHA: true,
    async run({ ha }) {
      const first = await ha!.subscribeOnce({ type: 'trigger_platforms/subscribe' }, 5_000)
      if (first === undefined) return { status: 'avviso', summary: 'Nessun evento ricevuto entro 5 s' }
      const keys = first && typeof first === 'object' ? Object.keys(first as Record<string, unknown>) : []
      return ok(`${keys.length} tipi di trigger disponibili`, { esempi: keys.slice(0, 12) })
    },
  },
  {
    id: 'manifest',
    label: 'Manifest delle integrazioni',
    needsHA: true,
    async run({ ha }) {
      const m = await ha!.call<{ name: string; documentation?: string }>({ type: 'manifest/get', integration: 'automation' })
      return ok(`${m.name}: ${m.documentation ?? 'documentazione non indicata'}`)
    },
  },
]

export async function runProbes(deps: {
  conn: HAConnection | null
  rest: HARest
  mode: Mode
  timeoutMs?: number
}): Promise<ProbeResult[]> {
  const ha = deps.conn && deps.conn.state === 'connected' ? readOnly(deps.conn) : null
  const ctx: ProbeContext = { ha, rest: deps.rest, mode: deps.mode, shared: {} }
  const results: ProbeResult[] = []
  for (const probe of PROBES) {
    const started = performance.now()
    let partial: Omit<ProbeResult, 'id' | 'label' | 'ms'>
    if (probe.needsHA && !ha) {
      partial = { status: 'errore', summary: 'Home Assistant non connesso via WebSocket' }
    } else {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        partial = await Promise.race([
          probe.run(ctx),
          new Promise<never>((_, rej) => {
            timer = setTimeout(() => rej(new Error('tempo scaduto')), deps.timeoutMs ?? 90_000)
          }),
        ])
      } catch (err) {
        const e = err as { code?: string; message?: string }
        partial = { status: 'errore', summary: e.code ? `${e.code}: ${e.message}` : String(e.message ?? err) }
      } finally {
        clearTimeout(timer)
      }
    }
    results.push({ id: probe.id, label: probe.label, ms: Math.round(performance.now() - started), ...partial })
  }
  return results
}
