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
import { DraftStore } from '../src/drafts/store.ts'
import { DraftService } from '../src/drafts/service.ts'
import { draftRoutes } from '../src/drafts/routes.ts'
import { msg, text, thinking, toolUse } from './fakeClaude.ts'
import { SuggestStore } from '../src/suggest/store.ts'
import { SuggestService } from '../src/suggest/service.ts'
import { suggestRoutes } from '../src/suggest/routes.ts'
import { fakeActivity, NOW } from './fakeActivity.ts'
import { verifyHome, VNOW } from './fakeVerify.ts'
import { VerifyStore } from '../src/verify/store.ts'
import { VerifyService } from '../src/verify/service.ts'
import { verifyRoutes } from '../src/verify/routes.ts'
import { KbStore, type Card } from '../src/devices/kb.ts'
import { DevicesService } from '../src/devices/service.ts'
import { devicesRoutes } from '../src/devices/routes.ts'
import { devicesHA } from './fakeDevices.ts'

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

const REVIEW_YAML = `alias: Assenza soggiorno
description: Spegne la lampada dopo 5 minuti senza nessuno (30 la sera)
triggers:
  - trigger: state
    entity_id: binary_sensor.radar_presenza
    to: "off"
    for: { minutes: 5 }
    id: "5"
  - trigger: state
    entity_id: binary_sensor.radar_presenza
    to: "off"
    for: { minutes: 30 }
    id: "30"
actions:
  - choose:
      - conditions:
          - condition: trigger
            id: ["5", "30"]
        sequence:
          - action: light.turn_off
            target:
              entity_id: light.lampada_arco
mode: restart
`

/** Valutazioni finte dell'analisi approfondita di Verifica. */
function previewReviews(content: string) {
  const ids = [...content.matchAll(/"automazione":"(automation\.[a-z0-9_]+)"/g)].map((m) => m[1]!)
  return {
    valutazioni: ids.map((a) =>
      a === 'automation.assenza_soggiorno'
        ? { automazione: a, giudizio: 'problemi', sintesi: 'Il ramo dei 5 minuti funziona, quello dei 30 non scatta mai: la condizione cerca l’id "530", che non esiste.', problemi: [{ titolo: 'Id "530" invece di "5" e "30"', spiegazione: 'Probabilmente una virgola persa: la luce resta accesa quando la stanza è vuota da 30 minuti.', gravita: 'alta' }, { titolo: 'mode single con attese lunghe', spiegazione: 'Se il radar torna "off" mentre aspetta, la nuova attivazione viene ignorata: meglio restart.', gravita: 'bassa' }], yaml_corretto: REVIEW_YAML, spiegazione_correzione: 'Usa gli id "5" e "30" e mode restart.' }
        : a === 'automation.aggiorna_stanza_demo'
          ? { automazione: a, giudizio: 'da_migliorare', sintesi: 'Fa quello che deve, ma scatta migliaia di volte all’ora per ogni variazione di distanza del sensore BLE.', problemi: [{ titolo: 'Trigger senza `to:`', spiegazione: 'Con `to: null` scatta solo quando cambia la stanza: stesse funzioni, una frazione delle esecuzioni.', gravita: 'media' }], yaml_corretto: '', spiegazione_correzione: 'Applica la correzione meccanica proposta dalla Verifica.' }
          : { automazione: a, giudizio: 'ok', sintesi: 'Nessun problema oltre a quelli già segnalati dai controlli.', problemi: [], yaml_corretto: '', spiegazione_correzione: '' },
    ),
  }
}

/** Risposte strutturate finte per Suggerisci e Verifica (proposte, valutazioni e correzioni). */
async function previewStructured(params: Parameters<StreamFn>[0], h: Parameters<StreamFn>[2]) {
  const schema = (params.output_config as { format?: { schema?: { required?: string[] } } }).format!.schema
  h.onBlockStart('thinking')
  await sleep(1500)
  if (schema?.required?.[0] === 'correzioni') return msg([text(JSON.stringify({ correzioni: [] }))], 'end_turn', { model: 'claude-opus-5-5' })
  if (schema?.required?.[0] === 'valutazioni') {
    const json = JSON.stringify(previewReviews(String(params.messages[0]!.content)))
    h.onBlockStart('text')
    h.onText(json)
    return msg([thinking(), text(json)], 'end_turn', { model: 'claude-opus-5-5', usage: { input_tokens: 9800, output_tokens: 4200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null, iterations: null } })
  }
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

/** Studio di un dispositivo simulato: una ricerca, una pagina letta, poi la scheda. */
async function previewStudy(params: Parameters<StreamFn>[0], signal: AbortSignal, h: Parameters<StreamFn>[2]) {
  const wait = async (ms: number) => {
    await sleep(ms)
    if (signal.aborted) throw Object.assign(new Error('annullato'), { name: 'AbortError' })
  }
  const subject = JSON.parse(/<dispositivo>\n([\s\S]*?)\n<\/dispositivo>/.exec(String(params.messages[0]!.content))![1]!) as { produttore: string; modello: string; integrazioni_home_assistant: Array<{ documentazione?: string }> }
  const name = subject.modello.toLowerCase().startsWith(subject.produttore.toLowerCase()) ? subject.modello : `${subject.produttore} ${subject.modello}`
  const forum = `https://community.home-assistant.io/t/${subject.modello.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-esperienze/101`
  const opus = { model: 'claude-opus-5-5', usage: { input_tokens: 6200, output_tokens: 1400, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null, iterations: null, server_tool_use: { web_search_requests: 1, web_fetch_requests: 1 } } }
  if (params.messages.length === 1) {
    h.onBlockStart('thinking')
    await wait(1200)
    h.onBlockStart('server_tool_use', 'web_search')
    await wait(1800)
    h.onBlockStart('server_tool_use', 'web_fetch')
    await wait(1800)
    return msg(
      [
        thinking(),
        { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: `${name} Home Assistant` } },
        { type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result', url: forum, title: `${name}: esperienze con Home Assistant`, page_age: null, encrypted_content: 'x' }] },
        { type: 'server_tool_use', id: 'f1', name: 'web_fetch', input: { url: forum } },
        { type: 'web_fetch_tool_result', tool_use_id: 'f1', content: { type: 'web_fetch_result', url: forum, retrieved_at: null, content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: '…' }, title: `${name}: esperienze con Home Assistant` } } },
      ],
      'pause_turn',
      opus,
    )
  }
  h.onBlockStart('tool_use', 'salva_scheda')
  await wait(1500)
  const doc = subject.integrazioni_home_assistant.find((i) => i.documentazione?.includes('home-assistant.io'))?.documentazione
  return msg(
    [
      toolUse('t1', 'salva_scheda', {
        nome_commerciale: name,
        categoria: 'sensore di presenza mmWave a zone',
        sintesi: 'Radar a onde millimetriche che rileva anche le persone ferme e divide la stanza in zone indipendenti, ognuna con la sua entità di occupazione. Più affidabile dei PIR per spegnere le luci, ma va tarato.',
        collegamento: 'Wi-Fi 2,4 GHz. In Home Assistant arriva in locale tramite HomeKit Controller (consigliato: risposta immediata) o tramite il cloud del produttore (più lento, dipende da Internet).',
        entita: [
          { cosa: 'binary_sensor di occupazione per zona', significato: '"on" finché qualcuno è nella zona; torna "off" dopo il tempo di assenza impostato nell’app.' },
          { cosa: 'sensore di illuminamento', significato: 'Lux misurati dal sensore: utile come condizione di buio, aggiornato ogni pochi minuti.' },
        ],
        eventi: [],
        consigli: ['Per spegnere le luci usa la zona più ampia con for: di 1–2 minuti, non le zone piccole.', 'Escludi nell’app le zone con tende o ventilatori che si muovono.'],
        limiti: ['Solo Wi-Fi a 2,4 GHz.', 'Alcuni utenti segnalano falsi positivi con animali domestici di grossa taglia.'],
        fonti: [{ url: forum, titolo: 'Esperienze sul forum di Home Assistant' }, ...(doc ? [{ url: doc, titolo: 'Documentazione dell’integrazione' }] : [])],
      }),
    ],
    'tool_use',
    { ...opus, usage: { ...opus.usage, server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 } } },
  )
}

const preview: StreamFn = async (params, signal, h) => {
  if ((params.tools as Array<{ name?: string }> | undefined)?.some((t) => t.name === 'salva_scheda')) return previewStudy(params, signal, h)
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
// Casa sintetica della Verifica (contiene anche quella di base): un caso noto per automazione.
const { ha, writer } = verifyHome()
const draftStore = new DraftStore(dir)
await draftStore.load()
const drafts = new DraftService({ store: draftStore, ha, writer, conversations: store, pollMs: 50 })
// Pagina Dispositivi: casa sintetica propria (stessi modelli da più integrazioni) e una scheda già approvata.
const kb = new KbStore(dir)
await kb.load()
const SHELLY_CARD: Card = {
  key: 'shelly|2pm gen4',
  manufacturer: 'Shelly',
  model: 'Shelly 2PM Gen4',
  modelIds: ['S4SW-002P16EU'],
  status: 'approvata',
  createdAt: '2026-10-14T18:20:00.000Z',
  studiedBy: 'Demo',
  approved: { at: '2026-10-14T18:25:00.000Z', by: 'Demo' },
  nome_commerciale: 'Shelly 2PM Gen4',
  categoria: 'relè a due canali con misura di potenza (anche modalità tapparella)',
  sintesi: 'Due uscite indipendenti da 10 A con misura di potenza ed energia per canale; in modalità tapparella diventa un singolo comando cover con posizione. Funziona in locale e risponde in meno di un secondo.',
  collegamento: 'Wi-Fi, Bluetooth e Zigbee/Matter a seconda del firmware. In Home Assistant: integrazione Shelly (locale, consigliata); via SmartThings arriva solo l’interruttore, senza misure.',
  entita: [
    { cosa: 'switch per canale', significato: 'Stato del relè; in modalità tapparella è sostituito da un’entità cover.' },
    { cosa: 'sensori di potenza ed energia per canale', significato: 'W istantanei e kWh totali: utili per capire quando un elettrodomestico ha finito.' },
  ],
  eventi: [{ evento: 'pressione breve e lunga degli ingressi', significato: 'Disponibili come entità event.* se l’ingresso è staccato dal relè.' }],
  consigli: ['Per “lavatrice finita” usa la potenza sotto 5 W per almeno 3 minuti, non lo stato del relè.'],
  limiti: ['La misura sotto 1 W è poco precisa.'],
  fonti: [
    { url: 'https://www.home-assistant.io/integrations/shelly', titolo: 'Integrazione Shelly – Home Assistant', aperta: true },
    { url: 'https://shelly-api-docs.shelly.cloud/gen2/', titolo: 'Documentazione API Shelly Gen2+', aperta: false },
  ],
  study: { model: 'claude-opus-5-5', effort: 'medium', costUsd: 0.214, searches: 2, fetches: 2, queries: ['Shelly 2PM Gen4 Home Assistant', 'S4SW-002P16EU power metering'], durationMs: 74000 },
}
await kb.save(SHELLY_CARD)
const devices = new DevicesService({ kb, ha: devicesHA(), settings, usage, options, stream: preview })
const chat = new ChatService({ store, ha, settings, usage, options, stream: preview, drafts, devices })
devices.attachChat(chat)
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
const verifyStore = new VerifyStore(dir, () => new Date(VNOW))
await verifyStore.load()
const verify = new VerifyService({ store: verifyStore, ha, writer, settings, usage, options, stream: preview, count: async (p) => 2400 + JSON.stringify(p).length / 3, drafts, draftStore, chat, now: () => new Date(VNOW) })
const server = createApp({
  routes: [
    ...buildRoutes({ mode: 'dev', conn: null, rest: new HARest({ mode: 'none', wsUrl: '', restBase: '', token: '' }), options, addon: null, usage }),
    ...chatRoutes({ chat, store, settings, usage, options, ha, drafts: draftStore }),
    ...draftRoutes({ service: drafts, store: draftStore }),
    ...suggestRoutes({ service: suggest, store: suggestStore, settings, usage, options, ha }),
    ...verifyRoutes({ service: verify, store: verifyStore, usage, options }),
    ...devicesRoutes({ service: devices, usage, options }),
  ],
  wwwDir: process.env.ASSISTANT_WWW_DIR ?? resolve(import.meta.dirname, '../../web/dist'),
  access: { mode: 'dev', isAdmin: async () => true },
})
server.listen(Number(process.env.PORT) || 8099, '127.0.0.1', () => console.log(`Anteprima su http://127.0.0.1:${Number(process.env.PORT) || 8099} (dati in ${dir})`))
