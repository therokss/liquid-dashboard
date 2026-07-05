# Changelog

Tutte le modifiche rilevanti a **Liquid Dashboard**. Formato ispirato a
[Keep a Changelog](https://keepachangelog.com/it/1.1.0/).

## [1.41.0] — 2026-07-05
### Aggiunto
- **Risposta immediata dei comandi (optimistic UI)**: quando accendi/spegni luci,
  interruttori, prese o ventilatori, l'interfaccia cambia **subito**, senza aspettare
  il round-trip verso il dispositivo. Se il dispositivo conferma, resta così; se **non
  risponde** entro pochi secondi, l'interfaccia **torna indietro** da sola allo stato
  reale. Vale anche per la luminosità impostata all'accensione.

## [1.40.2] — 2026-07-05
### Corretto
- **Testo leggibile su qualsiasi sfondo**: saluto, data e titoli delle sezioni ora si
  **adattano alla luminosità del wallpaper** (chiari su sfondi scuri e viceversa).
  Prima, con uno sfondo scuro e tema chiaro, restavano scuri e quasi invisibili.

## [1.40.1] — 2026-07-05
### Modificato
- **Nuovo logo**: icona "casa Liquid Glass" con goccia (gradiente ciano→viola).
  Applicata a icona/logo dell'add-on, icona dell'app iOS e schermata di setup.

## [1.40.0] — 2026-07-05
### Aggiunto
- **Sync "live" tra i dispositivi**: una modifica fatta sull'app compare sulla dashboard
  (e viceversa) entro pochi secondi, senza ricaricare. Un endpoint leggerissimo
  `/api/config-version` (solo timestamp) viene interrogato in polling e al ritorno in
  primo piano; la config piena si riscarica **solo** se qualcosa è cambiato.
### Corretto
- **Sfondi che non si sincronizzavano**: venivano salvati come blob URL locale
  (`blob:…`), valido solo nella sessione corrente e non trasferibile. Ora la foto è
  convertita in un data URL **ridimensionato** (canvas) → si salva davvero nel backend
  condiviso e compare su tutti i dispositivi.
- **Salvataggio sfondi rifiutato (413)**: alzato il limite del body JSON del server da
  100 KB a 12 MB (le foto in base64 pesano vari MB).
- **Config casa vuota in fallback**: se il backend risponde ma la config è ancora vuota,
  si recupera dallo storage per‑utente di Home Assistant (dati di versioni precedenti).

## [1.39.0] — 2026-07-05
### Aggiunto
- **API condivisa su porta diretta (8098)**: l'app iOS/Android legge e scrive le **stesse**
  impostazioni della dashboard (rifiuti, meteo, energia, aree, preferenze per‑utente),
  autenticandosi col **token di Home Assistant**. Configuri una volta → vale ovunque.
  Le API restano protette: in lettura serve un token valido, in scrittura della config
  condivisa serve un amministratore.

## [1.38.0] — 2026-07-05
### Modificato
- **Liquid Glass ritarato**: ridotti bianco speculare, rim luminoso, saturazione e alone
  dell'accent. Il vetro torna più **delicato e translucido** (niente effetto "plastica bianca"),
  mantenendo l'highlight sul bordo e le animazioni elastiche dei tasti.

## [1.37.0] — 2026-07-05
### Modificato
- **Effetto "Liquid Glass" più fedele a iOS**: più blur/saturazione, **highlight speculare**
  sul bordo superiore, **bevel** con rim luminoso e ombreggiatura più profonda e morbida.
- **Animazioni dei tasti elastiche**: alla pressione i pulsanti fanno "squish" e tornano con
  un **rimbalzo** morbido; l'ombra si abbassa al tocco. Toggle e card più fisici.
  Rispettata la preferenza `prefers-reduced-motion`.

## [1.36.0] — 2026-07-05
### Corretto
- **Aggiornamenti non visibili**: gli `update.*` (con categoria config/diagnostic) venivano
  esclusi dall'auto-nascondi. La pagina Aggiornamenti ora li mostra tutti.
- **Testo illeggibile in tema chiaro** nelle schermate a sfondo scuro (Aggiornamenti, Server,
  onboarding e i pannelli dei dispositivi/videocamera): forzato il contrasto chiaro al loro interno.

## [1.35.0] — 2026-07-05
### Aggiunto
- **Backup prima di aggiornare**: interruttore (attivo di default) nella pagina Aggiornamenti.
  Crea un backup prima di installare, **dove supportato** (Home Assistant Core, add-on).
  Le voci che verranno salvate mostrano l'etichetta **"backup"**; HACS/firmware lo ignorano.

## [1.34.0] — 2026-07-05
### Aggiunto
- **Aggiornamenti** (Impostazioni → Sistema, admin): elenco di tutti gli aggiornamenti
  disponibili (Home Assistant, add-on, HACS, firmware…) con versione attuale → nuova,
  **barra di avanzamento** durante l'installazione e link alle **note di rilascio**.
- Pulsante **"Aggiorna tutti"** (con conferma) per installare tutti gli aggiornamenti in
  un colpo. Badge con il numero di aggiornamenti in sospeso sulla voce di menu.

## [1.33.0] — 2026-07-05
### Aggiunto
- **Videocamere WebRTC**: le camere che lo supportano (go2rtc/Reolink/Frigate…) ora
  mostrano il **video fluido in tempo reale** via WebRTC (peer-to-peer), con ripiego
  automatico su MJPEG e poi snapshot se il WebRTC non è disponibile.
### Corretto
- **Rilevatori**: non compaiono più i sensori di "stato di salute" di **Proxmox** (VM/dischi)
  nella sezione Sicurezza — restano solo fumo, gas, CO, perdite, manomissioni.

## [1.32.0] — 2026-07-05
### Aggiunto
- **Sezione Sicurezza** dedicata nella barra di navigazione: **videocamere**, **porte e
  finestre**, **movimento**, **serrature**, **allarme** e **rilevatori** (fumo/gas/perdite).
- **Videocamere live**: le anteprime ora sono uno **stream in tempo reale** (MJPEG), non più
  uno scatto che si aggiorna ogni pochi secondi. Tocca per lo schermo intero.
### Modificato
- Aprendo una **videocamera** compaiono anche i suoi **controlli** (privacy, luce IR,
  rilevamenti…). I loro interruttori non appaiono più tra gli **"Interruttori"** della stanza.

## [1.31.0] — 2026-07-05
### Aggiunto
- **Luci**: toccando la card si apre un pannello con **luminosità, colori** (preset + colore
  libero), **temperatura** e le **scene collegate** alla luce.
- **Sicurezza**: nuova sezione in Home con le **videocamere** collegate (anteprima che si
  aggiorna, tocca per lo schermo intero).

## [1.30.0] — 2026-07-05
### Corretto
- Gli interruttori del **ventilatore** e del **Hue Play (Sync Box)** non compaiono più tra gli
  "Interruttori": i loro controlli sono nella card dedicata. La card Hue Sync è ora toccabile
  e apre il pannello con tutte le funzioni (dolby vision, sync mode, intensità…).

## [1.29.0] — 2026-07-05
### Aggiunto
- **Dispositivi con controlli completi**: i ventilatori compaiono con on/off e, al tocco, un
  pannello con **tutte le funzioni** (velocità, angoli, oscillazioni, blocco bambini…).
- **Badge finestre aperte** nelle card delle stanze.
### Corretto
- **Media**: niente più doppioni (il player in riproduzione non riappare tra gli attivi).
- **Plex nascosto di default** (creava un media_player per ogni client).

## [1.28.0] — 2026-07-04
### Aggiunto
- **Card Philips Hue Play (HDMI Sync Box)** nella stanza del dispositivo: accensione, 4 sorgenti
  HDMI, toggle sincronizzazione luci e luminosità (mostrata solo se disponibile).
- **Stanze visibili**: in Impostazioni (admin) puoi nascondere singole stanze dalla dashboard.

## [1.27.0] — 2026-07-04
### Modificato
- **Tema "Auto"** ora segue il tema chiaro/scuro del dispositivo (`prefers-color-scheme`), non più sempre scuro.
- La sezione **"Plancia a schermo intero"** mostra il tasto *Crea dashboard* solo se la plancia
  non esiste; se è già configurata mostra lo stato, e ricompare se un giorno manca.

## [1.26.0] — 2026-07-04
### Aggiunto
- **Auto‑retry di connessione**: al primo avvio (es. mentre Home Assistant si sta
  riavviando) la dashboard riprova da sola a connettersi, senza mostrare subito l'errore.

## [1.25.0] — 2026-07-04
### Aggiunto
- **Creazione automatica della plancia**: pulsante in Impostazioni (admin) che crea una
  dashboard "Casa" che apre la Liquid Dashboard a schermo intero (slug ingress rilevato in automatico).

## [1.24.0] — 2026-07-04
### Modificato
- **Config "della casa" condivisa**: rifiuti, meteo/calendario, energia e aree ora sono
  impostati dall'admin e **visti da tutti** (non più preferenze per‑utente). Migrazione
  automatica dei rifiuti già compilati.
- Le sezioni Meteo/Energia/Rifiuti in Impostazioni sono ora riservate all'admin.

## [1.23.0] — 2026-07-04
### Modificato
- **Dispositivi mobili**: una card per riga (nomi non più troncati) e **popup dettagli**
  al tocco (batteria, stato, posizione, rete, spazio, attività). Spostati sotto la sezione Rifiuti.

## [1.22.0] — 2026-07-04
### Aggiunto
- **Barra di completamento** sulle card elettrodomestici in funzione.
### Corretto
- Stepper visibilità: **selettore stanza** e salto delle **decisioni già prese**.
- Forno multi‑cavità unificato in una sola card; nascosti i dettagli non informativi.

## [1.21.0] — 2026-07-03
### Aggiunto
- Card **elettrodomestici SmartThings** (lavatrice, lavastoviglie, forno) nella stanza del dispositivo,
  con stato, programma/modalità e tempo di completamento.

## [1.20.0] — 2026-07-03
### Corretto
- Rilevamento dei **dispositivi mobili** collegati all'utente (match per persona).

## [1.19.0] — 2026-07-03
### Aggiunto
- Sezione **"I miei dispositivi"**: batteria, ricarica, posizione e connessione — ogni utente vede i suoi.

## [1.18.0] — 2026-07-03
### Corretto
- **Media**: un player in pausa resta tra "In riproduzione" per 5 minuti (così puoi riprenderlo);
  eliminati i doppioni tra le sezioni.

## [1.17.0] — 2026-07-03
### Modificato
- **Kiosk sempre attivo** all'avvio; il tasto per gestirlo è visibile solo agli amministratori.

## [1.16.0] — 2026-07-03
### Aggiunto
- **Preferenze per‑utente** sincronizzate lato add-on (tema, sfondi, visibilità seguono l'utente).

## [1.15.0] — 2026-07-03
### Aggiunto
- **Permessi utenti**: l'admin decide cosa possono modificare i non‑admin.
### Corretto
- **Discrepanza consumo rete**: letto anche lo statistic della rete salvato a livello sorgente
  (setup Shelly EM3) e mostrato il blocco **"Consumi non monitorati"**.
