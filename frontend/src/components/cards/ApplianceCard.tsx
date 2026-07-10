import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { WashingMachine, Microwave, Utensils, Clock, ChevronRight, type LucideIcon } from 'lucide-react'
import { useStore } from '../../store'
import { useLongPress } from '../../lib/useLongPress'
import { useT } from '../../i18n'
import type { HassEntity } from '../../types/ha'

// Elettrodomestici SmartThings (Samsung): riconosciuti da sensor.<x>_machine_state
// affiancato da _job_state / _completion_time. Card con stato, modalità e tempo.
// I forni multi-cavità vengono raggruppati per dispositivo (una sola card).

type ApplianceKind = 'washer' | 'dryer' | 'dishwasher' | 'oven'

interface Appliance {
  key: string
  entityId: string
  name: string
  kind: ApplianceKind
  machineState: string
  jobState: string | null
  completion: string | null
  program: string | null
  ovenMode: string | null
  temperature: number | null
  setpoint: number | null
  doorOpen: boolean
  cavityNote: string | null
  startTs: string | null
}

const KIND_ICON: Record<ApplianceKind, LucideIcon> = {
  washer: WashingMachine, dryer: WashingMachine, dishwasher: Utensils, oven: Microwave,
}
const MACHINE_LABEL: Record<string, string> = {
  run: 'In funzione', running: 'In funzione', pause: 'In pausa', paused: 'In pausa',
  stop: 'Fermo', stopped: 'Fermo', ready: 'Pronto', idle: 'Pronto',
  finished: 'Terminato', finish: 'Terminato', unknown: 'Non disponibile', unavailable: 'Non disponibile',
}
function machineColor(s: string): string {
  if (s === 'run' || s === 'running') return 'var(--accent)'
  if (s === 'pause' || s === 'paused') return '#ffb300'
  if (s === 'finished' || s === 'finish') return '#66bb6a'
  return 'var(--text-tertiary)'
}
const JOB_LABEL: Record<string, string> = {
  wash: 'Lavaggio', washing: 'Lavaggio', rinse: 'Risciacquo', rinsing: 'Risciacquo',
  spin: 'Centrifuga', soak: 'Ammollo', drying: 'Asciugatura', dry: 'Asciugatura',
  cooling: 'Raffreddamento', weightsensing: 'Pesatura', prewash: 'Prelavaggio',
  airwash: 'AirWash', finish: 'Fine', cooking: 'In cottura',
}

// Valori non informativi da non mostrare come dettaglio
const JUNK = new Set(['', 'none', 'unknown', 'unavailable', 'off', 'others', 'other', 'stop', 'idle', 'nooperation', 'no_operation', 'ready'])
function meaningful(v?: string): string | null {
  if (!v) return null
  const s = v.trim()
  return JUNK.has(s.toLowerCase()) ? null : s
}

function cleanName(friendly: string): string {
  return friendly
    .replace(/\s*(machine state|stato macchina|state)\s*$/i, '')
    .replace(/\s*second cavity\s*/i, ' ')
    .replace(/\s*2ª cavità\s*/i, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
function kindOf(name: string, hasOven: boolean): ApplianceKind {
  const n = name.toLowerCase()
  if (hasOven || /forno|oven/.test(n)) return 'oven'
  if (/lavastovigl|dishwash/.test(n)) return 'dishwasher'
  if (/asciugatric|dryer/.test(n)) return 'dryer'
  return 'washer'
}
function num(e?: HassEntity): number | null {
  if (!e) return null
  const n = parseFloat(e.state)
  return Number.isFinite(n) ? n : null
}
function isActive(st: string): boolean {
  return st === 'run' || st === 'running' || st === 'pause' || st === 'paused'
}

function buildAppliance(e: HassEntity, entities: Record<string, HassEntity>): Appliance {
  const id = e.entity_id
  const base = id.slice(0, -'_machine_state'.length)
  const get = (suffix: string) => entities[`${base}${suffix}`]
  const stem = base.slice('sensor.'.length)

  const ovenModeE = get('_modalita_forno') ?? get('_oven_mode')
  const setpoint = num(get('_setpoint'))
  const temperature = num(get('_temperatura')) ?? num(get('_temperature'))
  const hasOven = Boolean(ovenModeE || get('_setpoint'))
  const friendly = (e.attributes.friendly_name as string) || id
  const name = cleanName(friendly)
  const doorE = entities[`binary_sensor.${stem.replace(/_second_cavity$/, '')}_door`]

  return {
    key: base,
    entityId: id,
    name,
    kind: kindOf(name, hasOven),
    machineState: e.state,
    jobState: meaningful(get('_job_state')?.state),
    completion: get('_completion_time')?.state ?? null,
    program: meaningful(entities[`select.${stem}`]?.state),
    ovenMode: meaningful(ovenModeE?.state),
    temperature,
    setpoint,
    doorOpen: doorE?.state === 'on',
    cavityNote: id.includes('second_cavity') ? '2ª cavità' : null,
    startTs: e.last_changed ?? null,
  }
}

// % completamento stimata: da quando il ciclo è partito (last_changed dello stato
// macchina) fino al completion_time. Nessun sensore dedicato necessario.
function progressPct(startIso: string, endIso: string): number | null {
  const s = Date.parse(startIso)
  const e = Date.parse(endIso)
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return null
  return Math.max(0, Math.min(1, (Date.now() - s) / (e - s)))
}

export function AppliancesSection({ areaEntities, onOpen }: { areaEntities: HassEntity[]; onOpen?: (entityId: string) => void }) {
  const t = useT()
  const entities = useStore((s) => s.entities)
  const entityDevices = useStore((s) => s.entityDevices)
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30000)
    return () => clearInterval(id)
  }, [])

  const appliances = useMemo<Appliance[]>(() => {
    // Raggruppa i machine_state per dispositivo (forni multi-cavità → una card)
    const groups: Record<string, HassEntity[]> = {}
    for (const e of areaEntities) {
      const id = e.entity_id
      if (!id.startsWith('sensor.') || !id.endsWith('_machine_state')) continue
      const dev = entityDevices[id] || id
      ;(groups[dev] ??= []).push(e)
    }
    const out: Appliance[] = []
    for (const list of Object.values(groups)) {
      const primary =
        list.find((e) => isActive(e.state)) ||
        list.find((e) => !e.entity_id.includes('second_cavity')) ||
        list[0]
      out.push(buildAppliance(primary, entities))
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }, [areaEntities, entities, entityDevices])

  if (appliances.length === 0) return null

  return (
    <div>
      <div className="text-caption" style={{ marginBottom: 10 }}>{t('Elettrodomestici')}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {appliances.map((a) => <ApplianceCard key={a.key} a={a} onOpen={onOpen} />)}
      </div>
    </div>
  )
}

function remaining(iso: string): { label: string; end: string } | null {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const ms = t - Date.now()
  if (ms < 60000) return null
  const totMin = Math.round(ms / 60000)
  const h = Math.floor(totMin / 60)
  const m = totMin % 60
  const label = h > 0 ? `${h}h ${m}m` : `${m} min`
  const end = new Date(t).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  return { label, end }
}

function ApplianceCard({ a, onOpen }: { a: Appliance; onOpen?: (entityId: string) => void }) {
  const t = useT()
  const Icon = KIND_ICON[a.kind]
  const active = a.machineState === 'run' || a.machineState === 'running'
  const color = machineColor(a.machineState)
  const stateLabel = MACHINE_LABEL[a.machineState] ? t(MACHINE_LABEL[a.machineState]) : (a.machineState.charAt(0).toUpperCase() + a.machineState.slice(1))
  const rem = active && a.completion ? remaining(a.completion) : null
  const prog = active && a.completion && a.startTs ? progressPct(a.startTs, a.completion) : null

  const details: string[] = []
  if (a.cavityNote) details.push(a.cavityNote)
  if (a.kind === 'oven') {
    if (a.ovenMode) details.push(a.ovenMode)
    if (a.temperature !== null && a.temperature > 0) {
      details.push(a.setpoint && a.setpoint > 0 ? `${Math.round(a.temperature)}° / ${Math.round(a.setpoint)}°` : `${Math.round(a.temperature)}°`)
    }
  } else {
    if (a.program) details.push(a.program)
    if (a.jobState) details.push(JOB_LABEL[a.jobState.toLowerCase()] ? t(JOB_LABEL[a.jobState.toLowerCase()]) : a.jobState)
  }
  if (a.doorOpen) details.push(t('Sportello aperto'))

  const lp = useLongPress(() => onOpen?.(a.entityId))

  return (
    <motion.div whileTap={onOpen ? { scale: 0.97 } : undefined} className="glass-card" {...(onOpen ? lp : {})} style={{ padding: 'var(--space-md)', cursor: onOpen ? 'pointer' : 'default', opacity: active || a.machineState === 'pause' ? 1 : 0.82 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 42, height: 42, borderRadius: 12, flexShrink: 0,
          background: active ? 'var(--accent-glow)' : 'var(--glass-bg-active)',
          border: '1px solid var(--glass-border)',
          color: active ? 'var(--accent)' : 'var(--text-secondary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: active ? '0 0 20px var(--accent-glow)' : 'none',
        }}>
          <Icon size={21} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
          {details.length > 0 && (
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {details.join(' · ')}
            </div>
          )}
        </div>
        <span style={{
          flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 999,
          fontSize: 12, fontWeight: 700, color, background: 'color-mix(in srgb, currentColor 14%, transparent)',
          border: '1px solid color-mix(in srgb, currentColor 40%, transparent)',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', boxShadow: active ? '0 0 6px currentColor' : 'none' }} />
          {stateLabel}
        </span>
        {onOpen && <ChevronRight size={17} color="var(--text-tertiary)" style={{ flexShrink: 0 }} />}
      </div>

      {rem && (
        <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, background: 'var(--accent-glow)', border: '1px solid var(--glass-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: prog !== null ? 9 : 0 }}>
            <Clock size={15} color="var(--accent)" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{t('Tra {{label}}', { label: rem.label })}</span>
            <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{t('· finisce alle {{end}}', { end: rem.end })}</span>
            {prog !== null && (
              <span style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 700, color: 'var(--accent)' }}>{Math.round(prog * 100)}%</span>
            )}
          </div>
          {prog !== null && (
            <div style={{ height: 6, borderRadius: 3, background: 'var(--glass-border)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.round(prog * 100)}%`, background: 'var(--accent)', borderRadius: 3, boxShadow: '0 0 8px var(--accent-glow)', transition: 'width 0.6s ease' }} />
            </div>
          )}
        </div>
      )}
    </motion.div>
  )
}
