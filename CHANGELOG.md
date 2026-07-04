# Changelog

Tutte le modifiche rilevanti a **Liquid Dashboard**. Formato ispirato a
[Keep a Changelog](https://keepachangelog.com/it/1.1.0/).

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
