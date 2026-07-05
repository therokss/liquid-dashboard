# 💧 Liquid Dashboard — Add-on per Home Assistant

Dashboard in stile **iOS 26 "Liquid Glass"** per Home Assistant: effetto vetro, accento
neon, animazioni elastiche e temi per ora del giorno. Gira come **add-on ingress**:
**nessun token da configurare**, si autentica da sola tramite il Supervisor e legge le tue
stanze, entità e aree.

Esiste anche come **app nativa iOS/Android** (vedi [📱 App nativa](#-app-nativa-ios--android))
che condivide le **stesse** impostazioni dell'add-on e si aggiorna **in tempo reale** con la
dashboard.

Architetture: `aarch64`, `amd64`, `armv7`, `armhf`, `i386`.

[![Aggiungi il repository alla tua istanza Home Assistant.](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Ftherokss%2Fliquid-dashboard)

---

## ✅ Requisiti

> ⚠️ **Serve Home Assistant con Supervisor** — cioè **Home Assistant OS** o **Supervised**.
> Su **Home Assistant Container** (Docker semplice) o **Core** (venv) gli add-on non
> esistono e non è installabile.

Alla prima installazione l'add-on viene **compilato in locale** sul tuo HA (ci vogliono
un paio di minuti e una connessione a internet). Il frontend è già incluso pronto all'uso.

---

## 📦 Installazione

> ⚡ **Un click**: premi il badge **"Add repository"** qui sopra — si apre la tua istanza
> Home Assistant già pronta ad aggiungere questo repository. Poi salta al **punto 4**.

In alternativa, manualmente:

1. In Home Assistant vai su **Impostazioni → Add-on → Store add-on**.
2. In alto a destra apri il menù **⋮ → Repository**.
3. Incolla l'URL di questo repository e premi **Aggiungi**:
   ```
   https://github.com/therokss/liquid-dashboard
   ```
4. Chiudi, aggiorna la pagina: nello store comparirà **Liquid Dashboard**.
5. Aprila → **Installa** → **Avvia** (lascia attivo *"Mostra nella barra laterale"*).
6. Apri **Liquid Dashboard** dalla barra laterale — **si connette da sola**, senza token.

> Al primo avvio, se sei amministratore, parte un breve wizard (assegnazione stanze +
> visibilità dispositivi). Gli altri utenti vedono subito la dashboard con le impostazioni
> decise dall'admin.

---

## ✨ Funzionalità

**Casa** — saluto, meteo, energia, calendario, raccolta rifiuti, "In riproduzione",
i tuoi dispositivi mobili (batteria/posizione, per utente) e le stanze con temperatura media.

**Stanze** — griglia colorata per ambiente; dentro ogni stanza luci (con colori e scene),
clima, interruttori, ventilatori (controlli completi al tocco), elettrodomestici
**SmartThings** (lavatrice/lavastoviglie/forno con tempo di completamento) e la card
**Philips Hue Play (HDMI Sync Box)**. Badge luci accese e finestre aperte.

**🛡️ Sicurezza** (sezione dedicata) —
- **Videocamere live**: **WebRTC** (video fluido peer-to-peer) con ripiego automatico a
  MJPEG e snapshot. Al tocco: schermo intero + i **controlli della videocamera**
  (privacy, luce IR, rilevamenti…).
- **Porte e finestre**, **movimento**, **serrature**, **allarme** (attiva/disattiva) e
  **rilevatori** (fumo, gas, CO, perdite).

**Media** — tutti i player, con dedup e riproduzione in evidenza.

**Impostazioni** (admin) —
- **Aggiornamenti**: elenco di *tutti* gli update (Core, OS, add-on, HACS, firmware) con
  **"Aggiorna tutti"** e **backup** opzionale prima dell'aggiornamento.
- **Informazioni server**: CPU, memoria, disco, rete (System Monitor) + sensori aggiuntivi.
- **Permessi utenti**: l'admin decide cosa possono modificare gli altri.
- Aspetto (temi, sfondi per ora del giorno, intensità del vetro), stanze visibili,
  meteo/energia/rifiuti condivisi.

**Extra** — preferenze **per-utente** sincronizzate lato add-on (seguono l'utente su ogni
dispositivo), **sync "live"** tra dashboard e app (una modifica su un dispositivo compare
sull'altro in pochi secondi), **modalità kiosk** integrata, **auto-retry** di connessione ai
riavvii di HA, tema **Auto** che segue il sistema.

---

## 📱 App nativa (iOS / Android)

Oltre all'add-on, Liquid Dashboard esiste come **app client nativa** (React + Capacitor),
pensata per il telefono e il tablet quando non vuoi passare dal browser.

- **Stesse impostazioni della dashboard**: l'app parla con l'add-on su una porta dedicata
  (`8098`, protetta dal **token di Home Assistant**), così rifiuti, meteo, energia, aree,
  sfondi e preferenze sono **condivisi** — configuri una volta, vale ovunque.
- **Sync in tempo reale**: cambi qualcosa sull'app e compare sulla dashboard (e viceversa)
  entro pochi secondi, senza ricaricare.
- **Doppio indirizzo interno/esterno**: imposti un **URL interno** (rete di casa) e uno
  **esterno** (Nabu Casa o dominio remoto); l'app prova prima l'interno e, se sei fuori casa,
  ripiega **automaticamente** sull'esterno.
- **Accesso con token**: si collega direttamente a Home Assistant con un long-lived token
  (Profilo → Token di lunga durata). Puoi cambiare indirizzi e token in qualsiasi momento da
  **Impostazioni → Connessione** senza rifare la configurazione.

> L'app è un progetto Capacitor separato: richiede Home Assistant raggiungibile dal
> dispositivo e l'add-on installato per la condivisione delle impostazioni.

---

## 🏠 Renderla la plancia predefinita

### Modo semplice (consigliato) — dal pannello
Da **Impostazioni → Plancia a schermo intero → Crea dashboard** (visibile agli admin):
l'add-on crea da solo una dashboard **"Casa"** che apre la Liquid Dashboard a tutto schermo
(rileva lo slug in automatico). Poi ogni utente va su **Profilo → Dashboard predefinita →
Casa**.

### Manuale (se preferisci)
1. **Trova lo slug**: apri la dashboard e guarda l'URL `…/hassio/ingress/XXXXXXXX`.
   Da questo repo è tipo `a1b2c3d4_liquid_dashboard` (per l'add-on *locale* `local_liquid_dashboard`).
2. **Crea la dashboard contenitore**: Impostazioni → Dashboard → Aggiungi → *Nuova dall'inizio*
   (titolo *Casa*) → ✏️ Modifica → ⋮ → **Modifica in YAML** e incolla (con il tuo slug):
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
3. **Profilo utente → Dashboard predefinita → Casa**.

### Tablet a muro / telefono
Nel browser kiosk (es. *Fully Kiosk Browser*) usa come URL di avvio
`http://homeassistant.local:8123/hassio/ingress/<slug>` — la **modalità kiosk** è già
integrata (barra di HA nascosta). Sul telefono: apri l'URL e **"Aggiungi a schermata Home"**.

---

## ⚙️ Configurazione (opzionale)

L'add-on funziona **senza configurazione**. Opzioni disponibili solo se *non* usi l'ingress:

| Opzione   | Descrizione |
|-----------|-------------|
| `ha_url`  | URL di Home Assistant. Di norma lasciare vuoto. |
| `token`   | Long-lived token. Di norma lasciare vuoto. |

Preferenze, permessi e visibilità si gestiscono dalla scheda **Impostazioni** nella dashboard.

---


