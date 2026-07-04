# 💧 Liquid Dashboard — Add-on per Home Assistant

Dashboard in stile **iOS 26 "Liquid Glass"** per Home Assistant, con effetto vetro,
accento neon e temi per ora del giorno. Gira come **add-on ingress**: nessun token da
configurare, si autentica da sola tramite il Supervisor.

Funziona su: `aarch64`, `amd64`, `armv7`, `armhf`, `i386`.

---

## 📦 Installazione

1. In Home Assistant vai su **Impostazioni → Add-on → Add-on Store**.
2. In alto a destra apri il menù **⋮ → Repository**.
3. Incolla l'URL di questo repository e premi **Aggiungi**:
   ```
   https://github.com/therokss/liquid-dashboard
   ```
4. Chiudi, aggiorna la pagina: nello store comparirà **Liquid Dashboard**.
5. Aprila → **Installa** → **Avvia** (attiva anche *"Mostra nella barra laterale"*).
6. Apri **Liquid Dashboard** dalla barra laterale.

> Al primo avvio, se sei amministratore, parte un breve wizard di configurazione
> (assegnazione stanze + visibilità dispositivi). Gli altri utenti vedono subito la dashboard.

---

## 🔄 Aggiornamenti

Quando esce una nuova versione, Home Assistant mostra **"Aggiornamento disponibile"**
nella pagina dell'add-on: basta premere **Aggiorna**. Niente più ricostruzioni manuali.

---

## 🏠 Renderla la plancia predefinita

> **Nota tecnica:** Home Assistant non permette di impostare un add-on *ingress*
> direttamente come dashboard predefinita da `configuration.yaml` (l'URL ingress non
> è un pannello Lovelace). Il metodo qui sotto aggira il limite con una dashboard
> "contenitore" e **funziona per tutti gli utenti**.

### 1. Trova lo *slug* dell'add-on
Apri la Liquid Dashboard e guarda l'URL del browser:
```
…/hassio/ingress/XXXXXXXX
```
`XXXXXXXX` è lo slug. Per l'add-on **locale** è di solito `local_liquid_dashboard`;
installato **da questo repo** sarà simile a `a1b2c3d4_liquid_dashboard`.

### 2. Crea la dashboard contenitore
**Impostazioni → Dashboard → Aggiungi dashboard → Nuova dashboard dall'inizio**
(titolo es. *Casa*). Aprila → **✏️ Modifica** → menù ⋮ → **Modifica in YAML** e incolla
(sostituendo lo slug del punto 1):
```yaml
title: Casa
views:
  - type: panel
    title: Casa
    cards:
      - type: iframe
        url: /hassio/ingress/local_liquid_dashboard
        aspect_ratio: 100%
```

### 3. Impostala come predefinita
**Profilo utente** (in basso a sinistra) → **Dashboard predefinita → Casa**.
Ogni utente lo fa dal proprio profilo → all'avvio si apre la Liquid Dashboard a tutto schermo.

### Alternativa: tablet / pannello a muro (più pulito)
Niente iframe: nel browser kiosk (es. *Fully Kiosk Browser*) imposta come **URL di avvio**
`http://homeassistant.local:8123/hassio/ingress/local_liquid_dashboard`.
L'add-on ha già la **modalità kiosk** integrata (barra di HA nascosta).

### Sul telefono
Apri quell'URL nel browser e usa **"Aggiungi a schermata Home"**: si apre come app a tutto schermo.

---

## ⚙️ Configurazione (opzionale)

L'add-on funziona senza configurazione. Le opzioni disponibili:

| Opzione   | Descrizione |
|-----------|-------------|
| `ha_url`  | URL di Home Assistant (solo se non usi l'ingress). Di norma lasciare vuoto. |
| `token`   | Long-lived token (solo se non usi l'ingress). Di norma lasciare vuoto. |

Preferenze utente, permessi e visibilità si gestiscono dalla scheda **Impostazioni**
dentro la dashboard.

---

## 🧑‍💻 Sviluppo

Il codice sorgente del frontend è in [`frontend/`](./frontend) (React 19 + Vite + TypeScript);
l'add-on è in [`liquid_dashboard/`](./liquid_dashboard) (server Node + `www/` = build).

```bash
cd frontend
npm install
npm run build            # genera dist/
cp -R dist/* ../liquid_dashboard/www/   # aggiorna la build servita dall'add-on
```

Per pubblicare un aggiornamento: aumenta `version` in
`liquid_dashboard/config.yaml`, committa e fai push → HA proporrà l'update.

---

🤖 Add-on generato con [Claude Code](https://claude.com/claude-code)
