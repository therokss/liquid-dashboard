# Changelog

Tutte le modifiche rilevanti all'**Assistente Claude**. Formato ispirato a
[Keep a Changelog](https://keepachangelog.com/it/1.1.0/).

## [0.1.0] — 2026-10-14
### Aggiunto
- **Prima versione: le fondamenta.** Nuovo add-on con pannello "Assistente" nella barra
  laterale, visibile e utilizzabile solo dagli amministratori. Le schede Chat, Suggerisci,
  Verifica e Dispositivi sono già al loro posto e mostrano in quale versione arriveranno.
- **Diagnostica**: un pulsante verifica in sola lettura che l'add-on possa usare tutte le
  API di Home Assistant che serviranno dopo: registri di entità, dispositivi, aree e
  categorie, stati e servizi, validazione delle automazioni, lettura di un'automazione con
  la stessa API usata poi per scriverle, tracce, registro attività, storico e statistiche,
  catalogo dei trigger. Non modifica nulla: ogni comando passa da un elenco chiuso di
  operazioni di lettura.
- **Prova dello streaming**: verifica che le risposte arrivino al browser una alla volta
  anche attraverso l'ingress (e l'accesso remoto), come servirà per la chat.
- **Prova della connessione a Claude**: controlla la chiave API e i modelli scelti senza
  generare testo, quindi senza costi.
- **Opzioni**: chiave API Anthropic (campo protetto, non lascia mai l'add-on), modello ed
  effort per la chat (predefinito Claude Sonnet 5.5) e per le analisi (predefinito Claude
  Opus 5.5), soglie di budget mensile.
### Sicurezza
- Accetta richieste solo dal proxy ingress di Home Assistant e solo da amministratori;
  nessuna porta esposta sulla rete.
