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
- **Anteprima senza HA né chiave API**: `npm run preview` in `assistant/` (casa sintetica di
  `test/fakeHome.ts` e un Claude simulato) dopo `npx vite build` in `web/`, oppure con
  `npm run dev:web` per l'hot reload.
- Chat: prompt di sistema e tool sono congelati nell'intestazione di ogni conversazione
  (`/data/conversations/<id>.jsonl`, solo in aggiunta). Se cambi nomi o parametri dei tool
  incrementa `TOOLSET_VERSION` (`server/src/claude/tools/registry.ts`); se cambi il testo
  del prompt incrementa `PROMPT_VERSION`.
