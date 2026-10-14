import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createApp } from '../src/http/server.ts'
import { buildRoutes } from '../src/routes.ts'
import { chatRoutes } from '../src/chat/routes.ts'
import { ChatService } from '../src/chat/service.ts'
import { ConversationStore } from '../src/chat/store.ts'
import { SettingsStore } from '../src/store/settings.ts'
import { UsageLedger } from '../src/claude/usage.ts'
import { HARest } from '../src/ha/rest.ts'
import { DEFAULT_OPTIONS } from '../src/options.ts'
import type { StreamFn } from '../src/claude/loop.ts'
import { fakeHA } from './fakeHome.ts'
import { fakeWriter } from './fakeWriter.ts'
import { DraftStore } from '../src/drafts/store.ts'
import { DraftService } from '../src/drafts/service.ts'
import { draftRoutes } from '../src/drafts/routes.ts'
import { msg, text, thinking, toolUse } from './fakeClaude.ts'
import { SuggestStore } from '../src/suggest/store.ts'
import { SuggestService } from '../src/suggest/service.ts'
import { suggestRoutes } from '../src/suggest/routes.ts'
import { fakeActivity, NOW } from './fakeActivity.ts'

// Anteprima dell'interfaccia senza Home Assistant né chiave API: casa sintetica e un Claude
// simulato che risponde in streaming. Avvio: npm run preview (poi npm run dev:web).

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const ANSWER = `La **lampada arco** in soggiorno è accesa da stamattina alle 10:00.

| Entità | Stato |
|---|---|
| \`light.lampada_arco\` | on |
| \`binary_sensor.radar_presenza\` | off |

Se vuoi spegnerla quando la stanza resta vuota, ecco una proposta da incollare nell'editor:

\`\`\`yaml
alias: Spegni lampada arco senza presenza
description: Spegne la lampada dopo 10 minuti senza nessuno in soggiorno
triggers:
  - trigger: state
    entity_id: binary_sensor.radar_presenza
    to: "off"
    for: "00:10:00"
actions:
  - action: light.turn_off
    target:
      entity_id: light.lampada_arco
mode: single
\`\`\``

const DRAFT_YAML = `alias: Spegni lampada arco senza presenza
description: Spegne la lampada dopo 10 minuti senza nessuno in soggiorno
triggers:
  - trigger: state
    entity_id: binary_sensor.radar_presenza
    to: "off"
    for: "00:10:00"
conditions:
  - condition: state
    entity_id: light.lampada_arco
    state: "on"
actions:
  - action: light.turn_off
    target:
      entity_id: light.lampada_arco
mode: single
`

const SUGGEST_YAML = [
  DRAFT_YAML.replace('Spegni lampada arco senza presenza', 'Lampada arco col movimento al buio').replace('Spegne la lampada dopo 10 minuti senza nessuno in soggiorno', 'Accende la lampada arco quando il radar rileva qualcuno').replace('to: "off"', 'to: "on"').replace('    for: "00:10:00"\n', '').replace('state: "on"', 'state: "off"').replace('light.turn_off', 'light.turn_on'),
  `alias: Spegni la presa lavatrice di notte
description: Alle 23:00 spegne la presa della lavatrice se è rimasta accesa
triggers:
  - trigger: time
    at: "23:00:00"
conditions:
  - condition: state
    entity_id: switch.presa_lavatrice
    state: "on"
actions:
  - action: switch.turn_off
    target:
      entity_id: switch.presa_lavatrice
mode: single
`,
]

/** Risposte strutturate finte per Suggerisci (proposte e correzioni). */
async function previewStructured(params: Parameters<StreamFn>[0], h: Parameters<StreamFn>[2]) {
  const schema = (params.output_config as { format?: { schema?: { required?: string[] } } }).format!.schema
  h.onBlockStart('thinking')
  await sleep(1500)
  if (schema?.required?.[0] === 'correzioni') return msg([text(JSON.stringify({ correzioni: [] }))], 'end_turn', { model: 'claude-opus-5-5' })
  const ids = [...String(params.messages[0]!.content).matchAll(/"id":"(c\d+)"/g)].map((m) => m[1]!)
  const proposte = ids.map((id, i) =>
    i < 2
      ? { candidato: id, esito: 'proponi', titolo: i === 0 ? 'Luce col movimento quando fa buio' : 'Presa lavatrice spenta di notte', spiegazione: i === 0 ? 'Accesa a mano 20 volte su 20 entro mezzo minuto dal movimento, sempre col buio.' : 'Rimasta accesa 6 notti su 20: spegnerla alle 23 evita consumi inutili.', yaml: SUGGEST_YAML[i]!, confidenza: i === 0 ? 'alta' : 'media', rischi: i === 0 ? '' : 'Se un lavaggio parte tardi verrebbe interrotto.' }
      : i === 3
        ? { candidato: id, esito: 'proponi', titolo: 'Tapparella al mattino', spiegazione: 'Aperta a mano 14 feriali su 14 verso le 07:30.', yaml: SUGGEST_YAML[1]!.replace('state: "on"', 'state: NON_VALIDO'), confidenza: 'media', rischi: '' }
        : { candidato: id, esito: 'scarta', titolo: '', spiegazione: 'Lo fa già un programma esterno all’ora esatta: meglio lasciarlo dov’è o disattivarlo prima di spostarlo in Home Assistant.', yaml: '', confidenza: 'bassa', rischi: '' },
  )
  const json = JSON.stringify({ proposte })
  h.onBlockStart('text')
  for (const chunk of json.match(/[\s\S]{1,400}/g) ?? []) {
    h.onText(chunk)
    await sleep(60)
  }
  return msg([thinking(), text(json)], 'end_turn', { model: 'claude-opus-5-5', usage: { input_tokens: 5200, output_tokens: 9100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null, iterations: null } })
}

const preview: StreamFn = async (params, signal, h) => {
  if ((params.output_config as { format?: unknown } | undefined)?.format) return previewStructured(params, h)
  const last = params.messages[params.messages.length - 1]!
  const hasResult = Array.isArray(last.content) && last.content.some((b) => b.type === 'tool_result')
  const userText = JSON.stringify(params.messages.filter((m) => m.role === 'user').at(-1)?.content ?? '').toLowerCase()
  h.onBlockStart('thinking')
  await sleep(700)
  if (/\bcrea\b|spegn/.test(userText) && !hasResult) {
    h.onBlockStart('tool_use', 'proponi_automazione')
    await sleep(500)
    return msg([thinking(), toolUse(`tu_${Date.now()}`, 'proponi_automazione', { yaml: DRAFT_YAML, spiegazione: 'Spegne la lampada arco quando il radar non rileva nessuno per 10 minuti, solo se è accesa.' })], 'tool_use')
  }
  if (hasResult && /proponi_automazione|bozza/.test(JSON.stringify(last.content))) {
    const text1 = 'Ho preparato la bozza: controlla i dettagli nella scheda e premi **Crea automazione** se ti va bene.'
    h.onBlockStart('text')
    h.onText(text1)
    return msg([thinking(), text(text1)], 'end_turn')
  }
  if (!hasResult) {
    h.onBlockStart('tool_use', 'dettagli_entita')
    await sleep(400)
    return msg([thinking(), toolUse(`tu_${Date.now()}`, 'dettagli_entita', { entity_id: 'light.lampada_arco' }), toolUse(`tu_${Date.now()}b`, 'riepilogo_storico', { entity_ids: ['binary_sensor.radar_presenza'], ore: 24 })], 'tool_use')
  }
  h.onBlockStart('text')
  for (const chunk of ANSWER.match(/[\s\S]{1,12}/g) ?? []) {
    if (signal.aborted) throw Object.assign(new Error('annullato'), { name: 'AbortError' })
    h.onText(chunk)
    await sleep(25)
  }
  return msg([thinking(), text(ANSWER)], 'end_turn')
}

const dir = await mkdtemp(join(tmpdir(), 'assistente-preview-'))
const options = { ...DEFAULT_OPTIONS, anthropicApiKey: 'sk-ant-anteprima' }
const store = new ConversationStore(dir)
await store.load()
const settings = new SettingsStore(dir)
await settings.load()
const usage = new UsageLedger(dir, () => 'Europe/Rome')
const ha = fakeHA()
const draftStore = new DraftStore(dir)
await draftStore.load()
const drafts = new DraftService({ store: draftStore, ha, writer: fakeWriter(await ha.states()), conversations: store, pollMs: 50 })
const chat = new ChatService({ store, ha, settings, usage, options, stream: preview, drafts })
const suggestStore = new SuggestStore(dir, () => new Date(NOW))
await suggestStore.load()
const suggest = new SuggestService({
  store: suggestStore,
  ha,
  settings,
  usage,
  options,
  stream: preview,
  count: async () => 5200,
  drafts,
  draftStore,
  chat,
  now: () => new Date(NOW),
  collect: async (_ha, opts) => {
    for (const [phase, total] of [['Registri e configurazione', 0], ['Automazioni esistenti', 120], ['Registro attività', 21], ['Luminosità per stanza', 0]] as const) {
      for (let i = 0; i <= Math.min(total, 6); i++) {
        opts.onProgress?.({ phase, done: Math.round((i / 6) * total), total })
        await sleep(250)
      }
    }
    return fakeActivity()
  },
})
const server = createApp({
  routes: [
    ...buildRoutes({ mode: 'dev', conn: null, rest: new HARest({ mode: 'none', wsUrl: '', restBase: '', token: '' }), options, addon: null, usage }),
    ...chatRoutes({ chat, store, settings, usage, options, ha, drafts: draftStore }),
    ...draftRoutes({ service: drafts, store: draftStore }),
    ...suggestRoutes({ service: suggest, store: suggestStore, settings, usage, options, ha }),
  ],
  wwwDir: process.env.ASSISTANT_WWW_DIR ?? resolve(import.meta.dirname, '../../web/dist'),
  access: { mode: 'dev', isAdmin: async () => true },
})
server.listen(Number(process.env.PORT) || 8099, '127.0.0.1', () => console.log(`Anteprima su http://127.0.0.1:${Number(process.env.PORT) || 8099} (dati in ${dir})`))
