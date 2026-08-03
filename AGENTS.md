# Convenzioni del progetto

## Branch

I branch si chiamano con la versione dell'add-on su cui si sta lavorando: `v1.46.23`,
`v1.47.0`, … Niente prefissi di altro genere.

La versione va tenuta allineata in `liquid_dashboard/config.yaml`, nel log di avvio di
`liquid_dashboard/server.js` e nei due CHANGELOG (`CHANGELOG.md` e la sua copia
`liquid_dashboard/CHANGELOG.md`).

## Commit

Messaggi in italiano, senza trailer di attribuzione o firme di strumenti esterni.

## Build

Il frontend sta in `frontend/` (Vite + React); l'add-on serve il build già compilato da
`liquid_dashboard/www/`. Dopo una modifica al frontend: `npm run build` in `frontend/`,
poi sostituire `liquid_dashboard/www` con il contenuto di `frontend/dist`.
