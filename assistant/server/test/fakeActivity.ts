import type { Activity, ActivityEvent, AutomationInfo, Cause, EntityMeta } from '../src/suggest/types.ts'

// Storico sintetico per il motore di Suggerisci (SOLO dati inventati: il repo è pubblico).
// 20 giorni completi dal 24/09 al 13/10/2026, ora legale italiana (UTC+2).

export const NOW = Date.parse('2026-10-14T20:00:00+02:00')
export const FROM = Date.parse('2026-09-24T00:00:00+02:00')

/** Generatore pseudo-casuale riproducibile. */
function lcg(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

export function days(): string[] {
  const out: string[] = []
  for (let t = FROM + 12 * 3_600_000; t < NOW - 86_400_000; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10))
  }
  return out
}

export function at(day: string, hms: string, plusSeconds = 0): number {
  return Date.parse(`${day}T${hms}+02:00`) + plusSeconds * 1000
}

const dow = (day: string) => {
  const d = new Date(`${day}T12:00:00Z`).getUTCDay()
  return d === 0 ? 7 : d
}

function meta(id: string, name: string, areaId: string | null, deviceClass: string | null = null): EntityMeta {
  const areaNames: Record<string, string> = { cucina: 'Cucina', camera: 'Camera', soggiorno: 'Soggiorno', esterno: 'Esterno', ingresso: 'Ingresso' }
  return { id, domain: id.split('.')[0]!, name, areaId, areaName: areaId ? areaNames[areaId]! : null, deviceClass }
}

export const ENTITIES: EntityMeta[] = [
  meta('binary_sensor.movimento_cucina', 'Movimento cucina', 'cucina', 'motion'),
  meta('light.cucina', 'Luce cucina', 'cucina'),
  meta('cover.tapparella_camera', 'Tapparella camera', 'camera'),
  meta('light.camera', 'Luce camera', 'camera'),
  meta('event.pulsante_camera', 'Pulsante comodino', 'camera', 'button'),
  meta('light.soggiorno', 'Luce soggiorno', 'soggiorno'),
  meta('light.esterno', 'Luce giardino', 'esterno'),
  meta('binary_sensor.porta_ingresso', 'Porta ingresso', 'ingresso', 'door'),
  meta('light.ingresso', 'Luce ingresso', 'ingresso'),
  meta('person.demo', 'Demo', null),
]

export const AUTOMATIONS: AutomationInfo[] = [
  {
    entityId: 'automation.luce_ingresso',
    id: '1700000000009',
    alias: 'Luce ingresso alla porta',
    enabled: true,
    unavailable: false,
    triggerEntities: ['binary_sensor.porta_ingresso'],
    conditionEntities: [],
    actionEntities: ['light.ingresso'],
    triggerKinds: ['state'],
  },
]

export function fakeActivity(opts: { seed?: number } = {}): Activity {
  const rnd = lcg(opts.seed ?? 7)
  const events: ActivityEvent[] = []
  const push = (t: number, e: string, s: string, c: Cause, extra: Partial<ActivityEvent> = {}) => events.push({ t, e, s, c, ...extra })
  // Stati iniziali (prima della finestra non si sa nulla: un evento di partenza alle 00:00:30).
  const d0 = days()[0]!
  push(at(d0, '00:00:30'), 'light.cucina', 'off', 'fisico')
  push(at(d0, '00:00:30'), 'light.soggiorno', 'off', 'fisico')
  push(at(d0, '00:00:30'), 'cover.tapparella_camera', 'closed', 'fisico')
  push(at(d0, '00:00:30'), 'light.ingresso', 'off', 'fisico')
  push(at(d0, '00:00:30'), 'person.demo', 'home', 'fisico')

  days().forEach((day, i) => {
    const weekday = dow(day) <= 5
    // (b) movimento in cucina più volte al giorno; la luce si accende a mano solo la sera.
    for (const h of ['10:00:00', '13:00:00']) push(at(day, h, Math.floor(rnd() * 600)), 'binary_sensor.movimento_cucina', 'on', 'fisico')
    const m = at(day, '19:40:00', Math.floor(rnd() * 120))
    push(m, 'binary_sensor.movimento_cucina', 'on', 'fisico')
    push(m + (10 + Math.floor(rnd() * 30)) * 1000, 'light.cucina', 'on', 'manuale', { by: 'u'.repeat(32) })
    push(at(day, '23:00:00', Math.floor(rnd() * 600)), 'light.cucina', 'off', 'manuale')
    // (a) tapparella: feriali verso le 07:30, festivi verso le 09:00; chiusura la sera.
    push(at(day, weekday ? '07:25:00' : '09:00:00', Math.floor(rnd() * 600)), 'cover.tapparella_camera', 'open', 'manuale')
    push(at(day, '21:30:00', Math.floor(rnd() * 2400)), 'cover.tapparella_camera', 'closed', 'manuale')
    // (f) luce giardino accesa da un programma esterno, sempre alle 19:00 in punto.
    push(at(day, '19:00:00'), 'light.esterno', 'on', 'fisico')
    push(at(day, '23:30:00'), 'light.esterno', 'off', 'fisico')
    // (c) feriali: tutti fuori 09–17; nei primi 5 feriali la luce del soggiorno resta accesa.
    if (weekday) {
      push(at(day, '09:00:00'), 'person.demo', 'not_home', 'fisico')
      push(at(day, '17:00:00'), 'person.demo', 'home', 'fisico')
      if (i < 7) {
        push(at(day, '08:30:00'), 'light.soggiorno', 'on', 'manuale')
        push(at(day, '17:05:00'), 'light.soggiorno', 'off', 'manuale')
      }
    }
    // (d) pulsante premuto senza effetto, un giorno sì e uno no.
    if (i % 2 === 0) push(at(day, '22:45:00', Math.floor(rnd() * 300)), 'event.pulsante_camera', '2026-10-01T00:00:00.000+00:00', 'fisico', { et: 'single' })
    // (g) porta → luce ingresso a mano anche se c'è già un'automazione.
    if (i % 3 === 0) {
      const p = at(day, '18:00:00', Math.floor(rnd() * 600))
      push(p, 'binary_sensor.porta_ingresso', 'on', 'fisico')
      push(p + 20_000, 'light.ingresso', 'on', 'manuale')
      push(p + 600_000, 'light.ingresso', 'off', 'manuale')
      push(p + 60_000, 'binary_sensor.porta_ingresso', 'off', 'fisico')
    }
  })
  events.sort((a, b) => a.t - b.t)
  const byCause: Record<Cause, number> = { manuale: 0, automazione: 0, script: 0, sistema: 0, fisico: 0, altro: 0 }
  for (const ev of events) byCause[ev.c] += 1
  return {
    from: FROM,
    to: NOW,
    tz: 'Europe/Rome',
    country: 'IT',
    location: { lat: 41.9, lon: 12.5 },
    entities: new Map(ENTITIES.map((e) => [e.id, e])),
    events,
    automations: AUTOMATIONS,
    lux: new Map(),
    persons: ['person.demo'],
    stats: { entities: ENTITIES.length, events: events.length, byCause, firstDay: days()[0]!, requestedDays: 21, luxAreas: 0, automations: AUTOMATIONS.length },
  }
}
