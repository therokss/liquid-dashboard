# Changelog

Tutte le modifiche rilevanti all'**Assistente Claude**. Formato ispirato a
[Keep a Changelog](https://keepachangelog.com/it/1.1.0/).

## [0.2.0] — 2026-10-14
### Aggiunto
- **Chat con Claude che conosce la casa**, in sola lettura. Risponde su dispositivi, stati
  attuali, storici e automazioni ("perché ieri sera non è scattata?", "com'è andata la
  temperatura?", "quali automazioni usano il sensore di presenza?"). Se chiedi
  un'automazione prepara lo YAML con la sintassi attuale di Home Assistant, da incollare
  nell'editor con il pulsante **Copia**: la creazione con un tocco arriva nella 0.3.
- **Inventario della casa**: ogni nuova chat parte da un riepilogo compatto di piani, aree,
  dispositivi e automazioni (circa 500 entità utili su migliaia, scelte con regole fisse;
  quelle usate dalle automazioni sono sempre incluse). Niente stati né orari: quelli si
  leggono al momento con gli strumenti.
- **Strumenti di lettura** usati da Claude e mostrati nella chat come etichette: ricerca
  delle entità, dettagli di un'entità, riepilogo dello storico (minimi, massimi, medie,
  cambi di stato, mai i dati grezzi), elenco e lettura delle automazioni con le ultime
  esecuzioni, catalogo dei trigger, scheda di un dispositivo con la documentazione HA.
- **Conversazioni salvate** nell'add-on, con elenco, titolo automatico, costo per risposta
  e pulsante **Ferma**. La risposta prosegue sul server anche se chiudi la pagina: riaprendo
  la chat si riaggancia da dove era rimasta.
- **Impostazioni**: interruttori di privacy (posizione e GPS, telecamere e citofono, app
  mobile e salute — esclusi di default, riattivabili con avviso), anteprima di **cosa vede
  Claude**, modelli in uso e spesa del mese rispetto alle soglie. La Diagnostica ora si apre
  da qui.
- **Budget**: stima del costo di ogni risposta dai token usati; oltre la soglia di avviso
  compare un avviso, oltre quella di blocco l'add-on smette di chiamare Claude fino al mese
  successivo.
### Sicurezza e privacy
- Gli attributi inviati a Claude sono ripuliti da token, password, indirizzi IP e MAC, URL,
  numeri di serie e coordinate; le persone risultano solo "a casa" o "fuori casa" se la
  posizione non è attivata. Webhook e segreti nelle configurazioni delle automazioni sono
  oscurati.
- Le richieste che modificano qualcosa richiedono un header dedicato: un sito esterno non
  può inviarle a tuo nome.
- I dati di Home Assistant sono trattati come dati, non come istruzioni: un nome di
  dispositivo o un messaggio non possono dare ordini all'assistente.
### Note tecniche
- Prompt di sistema e strumenti sono congelati per ogni conversazione, che è salvata solo in
  aggiunta: la cache del prompt di Anthropic riduce il costo dei turni successivi e un
  riavvio dell'add-on a metà risposta non rompe la chat.
- Se un modello rifiuta una richiesta, Anthropic la ripassa in automatico a un modello di
  riserva (indicato sotto la risposta).

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
