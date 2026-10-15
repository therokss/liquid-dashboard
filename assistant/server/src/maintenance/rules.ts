import type { AreaEntry, DeviceEntry, EntityEntry, HAState, Registries } from '../ha/types.ts'
import { deviceName } from '../ha/types.ts'
import { buildInventory } from '../inventory/inventory.ts'
import { domainOf, type Consents } from '../inventory/privacy.ts'
import { normalizeText, type Manifest } from '../devices/catalog.ts'
import { KINDS, type Action, type ConfigEntryInfo, type Issue, type IssueDevice, type IssueKind, type ReauthFlow } from './types.ts'

export const OFFLINE_DAYS = 30
/** Sotto questa copertura dello storico non si giudica "offline da molto". */
export const MIN_COVERAGE_DAYS = 7
export const BATTERY_LOW = 20
const DAY = 86_400_000

/** Domini senza uno stato "acceso/spento" significativo: non dicono se il dispositivo risponde. */
const STATELESS = new Set(['button', 'input_button', 'scene', 'event', 'notify', 'update', 'image', 'tts', 'stt', 'conversation', 'ai_task', 'script', 'automation'])
/** Nulla esce dall'add-on, ma telefoni e tracker non vanno "messi in una stanza". */
const LOCAL_CONSENTS: Consents = { posizione: false, telecamere: true, appMobile: false }
const ERROR_STATES = new Set(['setup_error', 'setup_retry', 'migration_error', 'failed_unload'])

export interface MaintenanceInput {
  now: number
  registries: Registries
  states: Map<string, HAState>
  entries: ConfigEntryInfo[]
  reauth: ReauthFlow[]
  manifests: Map<string, Manifest>
  /** ultimo stato valido nello storico per le entità candidate offline; null = nessuno nel periodo */
  lastValid: Map<string, number | null>
  coverageDays: number
}

interface Ctx {
  input: MaintenanceInput
  devices: Map<string, DeviceEntry>
  areas: Map<string, AreaEntry>
  entriesById: Map<string, ConfigEntryInfo>
  byDevice: Map<string, EntityEntry[]>
}

function context(input: MaintenanceInput): Ctx {
  const byDevice = new Map<string, EntityEntry[]>()
  for (const e of input.registries.entities) if (e.device_id && !e.disabled_by) byDevice.set(e.device_id, [...(byDevice.get(e.device_id) ?? []), e])
  return {
    input,
    devices: new Map(input.registries.devices.map((d) => [d.id, d])),
    areas: new Map(input.registries.areas.map((a) => [a.area_id, a])),
    entriesById: new Map(input.entries.map((e) => [e.entryId, e])),
    byDevice,
  }
}

function entryOf(ctx: Ctx, d: DeviceEntry): ConfigEntryInfo | undefined {
  const id = d.primary_config_entry ?? d.config_entries[0]
  return id ? ctx.entriesById.get(id) : undefined
}

function issueDevice(ctx: Ctx, d: DeviceEntry): IssueDevice {
  const entry = entryOf(ctx, d)
  const domain = entry?.domain ?? null
  return {
    id: d.id,
    name: deviceName(d),
    area: d.area_id ? (ctx.areas.get(d.area_id)?.name ?? null) : null,
    integration: domain ? (ctx.input.manifests.get(domain)?.name ?? domain) : null,
    model: [d.manufacturer, d.model].filter(Boolean).join(' ') || null,
  }
}

const deviceLink = (id: string) => `/config/devices/device/${id}`
const loaded = (e: ConfigEntryInfo | undefined) => !e || e.state === 'loaded'
const isLocal = (iot: string | null | undefined) => Boolean(iot?.startsWith('local'))

function formatDate(t: number): string {
  return new Date(t).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/**
 * Dispositivi i cui stati significativi sono tutti "unavailable" adesso: per questi serve lo
 * storico (ultimo stato valido). Restituisce dispositivo → entità da cercare nello storico.
 */
export function offlineCandidates(input: Omit<MaintenanceInput, 'lastValid' | 'coverageDays'>): Map<string, string[]> {
  const ctx = context({ ...input, lastValid: new Map(), coverageDays: 0 })
  const out = new Map<string, string[]>()
  for (const d of input.registries.devices) {
    if (d.disabled_by || d.entry_type === 'service') continue
    if (!loaded(entryOf(ctx, d))) continue // integrazione in errore: si segnala a parte
    const use = significant(ctx, d)
    if (use.length && use.every((e) => input.states.get(e.entity_id)?.state === 'unavailable')) out.set(d.id, use.map((e) => e.entity_id))
  }
  return out
}

/** Entità che dicono se il dispositivo risponde: niente pulsanti/scene, niente entità orfane; le principali prima delle diagnostiche. */
function significant(ctx: Ctx, d: DeviceEntry): EntityEntry[] {
  const withState = (ctx.byDevice.get(d.id) ?? []).filter((e) => {
    const s = ctx.input.states.get(e.entity_id)
    return s && s.attributes.restored !== true && !STATELESS.has(domainOf(e.entity_id))
  })
  const primary = withState.filter((e) => !e.entity_category)
  return primary.length ? primary : withState
}

function offline(ctx: Ctx, push: (i: Omit<Issue, 'id'>) => void): void {
  const { input } = ctx
  for (const [deviceId, entityIds] of offlineCandidates(input)) {
    const d = ctx.devices.get(deviceId)!
    const known = entityIds.map((id) => input.lastValid.get(id))
    if (known.some((x) => x === undefined)) continue // storico non letto: meglio tacere
    const seen = known.filter((x): x is number => x !== null)
    let detail: string
    if (seen.length) {
      const last = Math.max(...seen)
      const days = Math.floor((input.now - last) / DAY)
      if (days < OFFLINE_DAYS) continue
      detail = `Nessun dato dal ${formatDate(last)} (${days} giorni).`
    } else {
      if (input.coverageDays < MIN_COVERAGE_DAYS) continue
      detail =
        input.coverageDays >= OFFLINE_DAYS
          ? `Nessun dato negli ultimi ${input.coverageDays} giorni.`
          : `Nessun dato in tutto lo storico disponibile (${input.coverageDays} giorni: il recorder non va più indietro).`
    }
    const entry = entryOf(ctx, d)
    const actions: Action[] = [{ type: 'disattiva', deviceId }]
    if (entry?.supportsRemoveDevice) actions.push({ type: 'elimina_dispositivo', deviceId, configEntryId: entry.entryId })
    push({
      kind: 'offline',
      signature: `offline:${deviceId}`,
      severity: 'avviso',
      title: `${deviceName(d)} non risponde`,
      detail,
      device: issueDevice(ctx, d),
      entities: entityIds,
      actions,
      link: deviceLink(deviceId),
    })
  }
}

function orphans(ctx: Ctx, push: (i: Omit<Issue, 'id'>) => void): void {
  const groups = new Map<string, EntityEntry[]>()
  for (const e of ctx.input.registries.entities) {
    if (e.disabled_by) continue
    if (ctx.input.states.get(e.entity_id)?.attributes.restored !== true) continue
    // Con l'integrazione ferma TUTTE le sue entità risultano "restored": non sono orfane.
    if (e.config_entry_id && !loaded(ctx.entriesById.get(e.config_entry_id))) continue
    const key = e.device_id ?? `platform:${e.platform}`
    groups.set(key, [...(groups.get(key) ?? []), e])
  }
  for (const [key, list] of groups) {
    const d = key.startsWith('platform:') ? undefined : ctx.devices.get(key)
    const ids = list.map((e) => e.entity_id).sort()
    const owner = d ? deviceName(d) : (ctx.input.manifests.get(list[0]!.platform)?.name ?? list[0]!.platform)
    push({
      kind: 'orfane',
      signature: `orfane:${key}:${ids.join(',')}`,
      severity: 'info',
      title: `${ids.length} ${ids.length === 1 ? 'entità non più fornita' : 'entità non più fornite'} · ${owner}`,
      detail: d ? 'Il dispositivo non le crea più: eliminarle non tocca le sue altre entità.' : `${owner} non le crea più.`,
      ...(d ? { device: issueDevice(ctx, d) } : {}),
      entities: ids,
      actions: [{ type: 'elimina_entita', entityIds: ids }],
      ...(d ? { link: deviceLink(d.id) } : {}),
    })
  }
}

/** Aree citate come parola intera in un testo (nome o alias, almeno 3 lettere). */
function mentionedAreas(ctx: Ctx, text: string): AreaEntry[] {
  const hay = ` ${normalizeText(text)} `
  const hits: Array<{ a: AreaEntry; len: number }> = []
  for (const a of ctx.areas.values()) {
    const terms = [a.name, ...a.aliases].map(normalizeText).filter((t) => t.length >= 3)
    const best = Math.max(0, ...terms.filter((t) => hay.includes(` ${t} `)).map((t) => t.length))
    if (best) hits.push({ a, len: best })
  }
  // "Camera ospiti" batte "Camera": tieni le aree col termine più lungo che non è contenuto in un altro.
  return hits.filter((h) => !hits.some((o) => o !== h && o.len > h.len && ` ${normalizeText(o.a.name)} `.includes(` ${normalizeText(h.a.name)} `))).map((h) => h.a)
}

function areaByName(ctx: Ctx, name: string): AreaEntry | undefined {
  const n = normalizeText(name)
  return [...ctx.areas.values()].find((a) => normalizeText(a.name) === n || a.aliases.some((x) => normalizeText(x) === n))
}

function rooms(ctx: Ctx, relevant: Set<string>, push: (i: Omit<Issue, 'id'>) => void): Set<string> {
  const done = new Set<string>()
  const move = (d: DeviceEntry, target: AreaEntry, confidence: 'certa' | 'da_verificare', why: string) => {
    if (done.has(d.id) || d.area_id === target.area_id) return
    done.add(d.id)
    const from = d.area_id ? (ctx.areas.get(d.area_id)?.name ?? d.area_id) : null
    push({
      kind: d.area_id ? 'stanza' : 'senza_area',
      signature: `${d.area_id ? 'stanza' : 'senza_area'}:${d.id}:${target.area_id}`,
      severity: 'info',
      confidence,
      title: from ? `${deviceName(d)}: ${from} → ${target.name}?` : `${deviceName(d)}: assegna a ${target.name}?`,
      detail: why,
      device: issueDevice(ctx, d),
      actions: [{ type: 'sposta', deviceId: d.id, areaId: target.area_id, areaName: target.name, from: d.area_id }],
      link: deviceLink(d.id),
    })
  }

  // 1. Stanze dell'app Hue: le luci di un gruppo "room" stanno in quella stanza.
  const entries = new Map(ctx.input.registries.entities.map((e) => [e.entity_id, e]))
  for (const s of ctx.input.states.values()) {
    const a = s.attributes
    if (domainOf(s.entity_id) !== 'light' || a.is_hue_group !== true || a.hue_type !== 'room' || !Array.isArray(a.entity_id)) continue
    const room = typeof a.friendly_name === 'string' ? a.friendly_name : null
    const target = room ? areaByName(ctx, room) : undefined
    if (!target) continue
    for (const member of a.entity_id) {
      const e = typeof member === 'string' ? entries.get(member) : undefined
      const d = e?.device_id ? ctx.devices.get(e.device_id) : undefined
      // Se l'entità ha un'area sua, spostare il dispositivo non cambierebbe nulla.
      if (!e || !d || d.disabled_by || e.area_id) continue
      move(d, target, 'certa', `Nell'app Hue è nella stanza "${room}".`)
    }
  }

  // 2. Il nome dice un'altra stanza; 3. senza area: nome o area delle sue entità.
  for (const d of ctx.devices.values()) {
    if (d.disabled_by || d.entry_type === 'service' || !relevant.has(d.id) || done.has(d.id)) continue
    const named = mentionedAreas(ctx, deviceName(d))
    if (d.area_id) {
      if (named.some((a) => a.area_id === d.area_id) || named.length !== 1) continue
      move(d, named[0]!, 'da_verificare', `Il nome cita "${named[0]!.name}", ma il dispositivo è in un'altra area.`)
      continue
    }
    if (named.length === 1) {
      move(d, named[0]!, 'da_verificare', `Non ha un'area e il nome cita "${named[0]!.name}".`)
      continue
    }
    const own = [...new Set((ctx.byDevice.get(d.id) ?? []).map((e) => e.area_id).filter((x): x is string => Boolean(x)))]
    if (own.length === 1 && ctx.areas.has(own[0]!)) move(d, ctx.areas.get(own[0]!)!, 'da_verificare', `Non ha un'area, ma le sue entità sono in "${ctx.areas.get(own[0]!)!.name}".`)
  }
  return done
}

function duplicates(ctx: Ctx, push: (i: Omit<Issue, 'id'>) => void): void {
  for (const [compositeId, split] of Object.entries(ctx.input.registries.compositeDevices ?? {})) {
    const parts = split.splitIds.map((id) => ctx.devices.get(id)).filter((d): d is DeviceEntry => Boolean(d && !d.disabled_by))
    if (parts.length < 2) continue
    const iot = (d: DeviceEntry) => {
      const domain = entryOf(ctx, d)?.domain
      return domain ? (ctx.input.manifests.get(domain)?.iotClass ?? null) : null
    }
    const locals = parts.filter((d) => isLocal(iot(d)))
    const clouds = parts.filter((d) => iot(d)?.startsWith('cloud'))
    if (!locals.length || !clouds.length) continue // tutti locali o tutti cloud: spesso servono a cose diverse
    const main = ctx.devices.get(split.primaryId ?? '') ?? locals[0]!
    const name = (d: DeviceEntry) => issueDevice(ctx, d).integration ?? '?'
    push({
      kind: 'doppione',
      signature: `doppione:${compositeId}:${clouds.map((d) => d.id).sort().join(',')}`,
      severity: 'info',
      confidence: 'da_verificare',
      title: `${deviceName(main)}: collegato in locale e via cloud`,
      detail: `Lo stesso oggetto arriva da ${locals.map(name).join(', ')} (locale) e da ${clouds.map(name).join(', ')} (cloud). Se le entità locali ti bastano, disattiva il collegamento cloud: meno doppioni e niente dipendenza da Internet. Prima sposta sulle entità locali le automazioni che usano quelle cloud.`,
      device: issueDevice(ctx, clouds[0]!),
      actions: clouds.map((d) => ({ type: 'disattiva' as const, deviceId: d.id })),
      link: deviceLink(clouds[0]!.id),
    })
  }
}

function integrations(ctx: Ctx, push: (i: Omit<Issue, 'id'>) => void): void {
  const name = (domain: string) => ctx.input.manifests.get(domain)?.name ?? domain
  const reauth = new Set<string>()
  for (const f of ctx.input.reauth) {
    const e = f.entryId ? ctx.entriesById.get(f.entryId) : undefined
    reauth.add(f.entryId ?? f.domain)
    push({
      kind: 'integrazione',
      signature: `integrazione:reauth:${f.entryId ?? f.domain}`,
      severity: 'avviso',
      title: `${name(f.domain)}: va ripetuto l'accesso`,
      detail: `${e?.title ? `"${e.title}": ` : ''}l'integrazione chiede di autenticarsi di nuovo (password cambiata o accesso scaduto). Finché non lo fai i suoi dispositivi non si aggiornano.`,
      actions: [],
      link: `/config/integrations/integration/${f.domain}`,
    })
  }
  for (const e of ctx.input.entries) {
    if (e.disabled || !ERROR_STATES.has(e.state) || reauth.has(e.entryId)) continue
    const what = e.state === 'setup_retry' ? 'non riesce a collegarsi e riprova di continuo' : e.state === 'migration_error' ? "non è riuscita ad aggiornare la configurazione" : 'non si avvia'
    push({
      kind: 'integrazione',
      signature: `integrazione:${e.entryId}`,
      severity: 'avviso',
      title: `${name(e.domain)}: ${what}`,
      detail: `${e.title ? `"${e.title}"` : 'Voce'}${e.reason ? `: ${e.reason}` : '.'} I suoi dispositivi risultano non disponibili finché non si risolve.`,
      actions: [],
      link: `/config/integrations/integration/${e.domain}`,
    })
  }
}

function batteries(ctx: Ctx, month: string, push: (i: Omit<Issue, 'id'>) => void): void {
  const low = new Map<string, { value: number | null; entityId: string }>()
  for (const e of ctx.input.registries.entities) {
    if (e.disabled_by || !e.device_id || e.platform === 'mobile_app') continue
    const s = ctx.input.states.get(e.entity_id)
    if (!s || s.attributes.device_class !== 'battery') continue
    const domain = domainOf(e.entity_id)
    let value: number | null
    if (domain === 'sensor' && s.attributes.unit_of_measurement === '%' && Number.isFinite(Number(s.state)) && s.state !== '') {
      value = Number(s.state)
      if (value >= BATTERY_LOW) continue
    } else if (domain === 'binary_sensor' && s.state === 'on') value = null
    else continue
    const prev = low.get(e.device_id)
    if (!prev || (value !== null && (prev.value === null || value < prev.value))) low.set(e.device_id, { value, entityId: e.entity_id })
  }
  for (const [deviceId, b] of low) {
    const d = ctx.devices.get(deviceId)
    if (!d || d.disabled_by) continue
    push({
      kind: 'batteria',
      signature: `batteria:${deviceId}:${month}`,
      severity: b.value !== null && b.value < 10 ? 'avviso' : 'info',
      title: `${deviceName(d)}: batteria ${b.value !== null ? percent(Math.round(b.value)) : 'scarica'}`,
      detail: `Da ${b.entityId}. Va cambiata o ricaricata presto.`,
      device: issueDevice(ctx, d),
      entities: [b.entityId],
      actions: [],
      link: deviceLink(deviceId),
    })
  }
}

/** "al 5%", "all'8%", "all'11%". */
function percent(n: number): string {
  return `${/^(1|8|11|8\d)$/.test(String(n)) ? "all'" : 'al '}${n}%`
}

function updates(ctx: Ctx, push: (i: Omit<Issue, 'id'>) => void): void {
  for (const e of ctx.input.registries.entities) {
    if (e.disabled_by || !e.device_id || domainOf(e.entity_id) !== 'update') continue
    const s = ctx.input.states.get(e.entity_id)
    const d = ctx.devices.get(e.device_id)
    if (!s || s.state !== 'on' || !d || d.disabled_by || d.entry_type === 'service') continue
    const a = s.attributes
    const latest = typeof a.latest_version === 'string' ? a.latest_version : '?'
    push({
      kind: 'aggiornamento',
      signature: `aggiornamento:${e.entity_id}:${latest}`,
      severity: 'info',
      title: `${deviceName(d)}: firmware ${latest}`,
      detail: `${typeof a.installed_version === 'string' ? `Installato ${a.installed_version}. ` : ''}${typeof a.title === 'string' ? `${a.title}. ` : ''}Si installa dalla pagina Aggiornamenti di Home Assistant: l'add-on non installa aggiornamenti.`,
      device: issueDevice(ctx, d),
      entities: [e.entity_id],
      actions: [],
      link: '/config/updates',
    })
  }
}

export interface MaintenanceResult {
  issues: Issue[]
  counts: Record<IssueKind, number>
  unassigned: IssueDevice[]
}

export function runMaintenance(input: MaintenanceInput): MaintenanceResult {
  const ctx = context(input)
  const out: Array<Omit<Issue, 'id'>> = []
  const push = (i: Omit<Issue, 'id'>) => out.push(i)
  // Dispositivi "di casa": quelli con almeno un'entità nell'inventario (niente client di rete,
  // servizi, telefoni…), come nel catalogo. Resta tutto nell'add-on: le telecamere contano.
  const inv = buildInventory({ registries: input.registries, states: input.states, consents: LOCAL_CONSENTS, referenced: new Set() })
  const relevant = new Set(inv.entities.map((e) => e.device_id).filter((x): x is string => Boolean(x)))

  integrations(ctx, push)
  offline(ctx, push)
  orphans(ctx, push)
  const placed = rooms(ctx, relevant, push)
  duplicates(ctx, push)
  batteries(ctx, new Date(input.now).toISOString().slice(0, 7), push)
  updates(ctx, push)

  const order = (k: IssueKind) => KINDS.indexOf(k)
  const sorted = out.sort((a, b) => order(a.kind) - order(b.kind) || (a.severity === b.severity ? 0 : a.severity === 'avviso' ? -1 : 1) || a.title.localeCompare(b.title))
  const issues = sorted.map((i, n) => ({ id: `m${n + 1}`, ...i }))
  const counts = Object.fromEntries(KINDS.map((k) => [k, issues.filter((i) => i.kind === k).length])) as Record<IssueKind, number>
  const unassigned = [...ctx.devices.values()]
    .filter((d) => !d.area_id && !d.disabled_by && d.entry_type !== 'service' && relevant.has(d.id) && !placed.has(d.id))
    .map((d) => issueDevice(ctx, d))
    .sort((a, b) => a.name.localeCompare(b.name))
  return { issues, counts, unassigned }
}
