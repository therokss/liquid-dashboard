# Convenzioni del progetto

## Branch

I branch si chiamano con la versione dell'add-on su cui si sta lavorando: `v1.46.23`,
`v1.47.0`, … Niente prefissi di altro genere.

La versione va tenuta allineata in `liquid_dashboard/config.yaml`, nel log di avvio di
`liquid_dashboard/server.js` e nei due CHANGELOG (`CHANGELOG.md` e la sua copia
`liquid_dashboard/CHANGELOG.md`).

## Commit

Messaggi in italiano, senza trailer di attribuzione o firme di strumenti esterni.

## Rilascio

A lavoro finito e verificato si va fino in fondo senza chiedere conferma: merge del branch
di versione su `main` (fast-forward) e push. È da `main` che Home Assistant vede
l'aggiornamento dell'add-on, quindi una modifica che resta sul branch non è rilasciata.

## Build

Il frontend sta in `frontend/` (Vite + React); l'add-on serve il build già compilato da
`liquid_dashboard/www/`. Dopo una modifica al frontend: `npm run build` in `frontend/`,
poi sostituire `liquid_dashboard/www` con il contenuto di `frontend/dist`.

## Add-on "Assistente Claude" (`claude_assistant/`)

Secondo add-on dello stesso repository, indipendente da Liquid Dashboard.

- **Sorgente** in `assistant/` (`server/` TypeScript, `web/` React + Vite); **artefatti** in
  `claude_assistant/` (`app/server.mjs` e `www/`), che è ciò che HA scarica e costruisce.
- **Versione** solo in `claude_assistant/config.yaml`: `npm run build` in `assistant/`
  (`scripts/release.mjs`) la inietta in server e interfaccia, esegue test e typecheck e
  rifiuta la build se `claude_assistant/CHANGELOG.md` non ha la voce della versione.
- **Branch** `assistente-v<versione>` (es. `assistente-v0.2.0`), per non confonderli con le
  versioni di Liquid Dashboard. Commit e rilascio come sopra.
- **CHANGELOG** solo in `claude_assistant/CHANGELOG.md` (quello in radice è di Liquid Dashboard).
- Il repo è pubblico: nei test e negli esempi solo dati sintetici, mai dati della casa reale.
- **Anteprima senza HA né chiave API**: `npm run preview` in `assistant/` (case sintetiche di
  `test/fakeHome.ts`, `test/fakeVerify.ts` e `test/fakeDevices.ts` e un Claude simulato) dopo `npx vite build` in `web/`, oppure con
  `npm run dev:web` per l'hot reload.
- Chat: prompt di sistema e tool sono congelati nell'intestazione di ogni conversazione
  (`/data/conversations/<id>.jsonl`, solo in aggiunta). Se cambi nomi o parametri dei tool
  incrementa `TOOLSET_VERSION` (`server/src/claude/tools/registry.ts`); se cambi il testo
  del prompt incrementa `PROMPT_VERSION`; aggiorna `SUPPORTED_TOOLSETS` con le versioni
  ancora eseguibili.
- Scritture in HA solo da `server/src/ha/writer.ts`, chiamato da `drafts/service.ts` dopo il
  tap dell'admin (route `/api/drafts/:id/apply|undo|discard`). I tool di Claude ricevono solo
  `HAReader` (sola lettura, elenco chiuso di comandi in `ha/data.ts`).
- Suggerisci (`server/src/suggest/`):
  - `collect.ts` legge il logbook a blocchi di un giorno e classifica le cause dai campi
    `context_*`;
  - `miner.ts` calcola in modo deterministico candidati, numeri ed esempi;
  - `service.ts` fa una sola chiamata con output strutturato (`claude/structured.ts`) e
    passa ogni YAML dalla pipeline delle bozze, con al più una correzione.

  I numeri mostrati vengono sempre dal miner, mai dal modello. Test con lo storico sintetico
  di `test/fakeActivity.ts`.
- Verifica (`server/src/verify/`):
  - `collect.ts` legge configurazioni (caricata e dell'editor, che decide se è modificabile),
    tracce, statistiche delle soglie e Registro attività delle entità comandate;
  - `rules.ts` (V1–V6, V9, V10) e `dynamic.ts` (V7–V8) producono i problemi in modo
    deterministico; `timepattern.ts` e `similar.ts` sono i casi delicati (somiglianze prudenti:
    stesse parole e stessi numeri);
  - `fixes.ts` applica le correzioni meccaniche alla config dell'editor e `service.ts` le
    passa a `DraftService.propose` con `sostituisce`;
  - l'analisi approfondita va a lotti di 5 con output strutturato, come Suggerisci.

  Le firme dei problemi (`regola:codice:id automazione:chiave`) servono a "Ignora": se le cambi,
  i problemi ignorati ricompaiono. Test con la casa sintetica di `test/fakeVerify.ts`, che è
  anche quella dell'anteprima.
- Dispositivi (`server/src/devices/`):
  - `catalog.ts` raggruppa i dispositivi per (produttore, modello) normalizzati, con alias
    dei produttori e unione per `model_id`;
  - `kb.ts` salva le schede in `/data/kb/devices/<slug>.json`. Lo schema zod `CardContent` è
    anche l'input dello strumento `salva_scheda`;
  - `study.ts` è il sotto-agente isolato:
    - strumenti `web_search_20260318` e `web_fetch_20260318`, con `allowed_domains` e
      `allowed_callers: ['direct']`, più `salva_scheda`;
    - gestisce `pause_turn` e fa fino a 2 correzioni se le fonti non sono state viste nella
      ricerca;
    - all'API va solo `StudySubject` (mai nomi, aree o stati).
  - `service.ts` esegue uno studio alla volta, in memoria, e fornisce l'indice e i tool alla
    chat (`leggi_scheda_dispositivo`, `studia_dispositivo`, con tetto per conversazione).

  Test con `test/fakeDevices.ts`, che verifica anche che nelle richieste non ci siano nomi
  della casa.
