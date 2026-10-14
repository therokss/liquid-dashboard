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

const preview: StreamFn = async (params, signal, h) => {
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
const server = createApp({
  routes: [
    ...buildRoutes({ mode: 'dev', conn: null, rest: new HARest({ mode: 'none', wsUrl: '', restBase: '', token: '' }), options, addon: null, usage }),
    ...chatRoutes({ chat, store, settings, usage, options, ha, drafts: draftStore }),
    ...draftRoutes({ service: drafts, store: draftStore }),
  ],
  wwwDir: process.env.ASSISTANT_WWW_DIR ?? resolve(import.meta.dirname, '../../web/dist'),
  access: { mode: 'dev', isAdmin: async () => true },
})
server.listen(Number(process.env.PORT) || 8099, '127.0.0.1', () => console.log(`Anteprima su http://127.0.0.1:${Number(process.env.PORT) || 8099} (dati in ${dir})`))
