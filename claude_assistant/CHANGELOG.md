# Changelog

Tutte le modifiche rilevanti all'**Assistente Claude**. Formato ispirato a
[Keep a Changelog](https://keepachangelog.com/it/1.1.0/).

## [0.3.1] — 2026-10-14
### Aggiunto
- **Interruttore di prova `input_boolean.test_claude`** ("Test Claude"), creato
  automaticamente al primo avvio dopo l'aggiornamento: serve a provare le bozze di
  automazione senza toccare dispositivi veri. È un normale aiutante (Impostazioni →
  Dispositivi e servizi → Aiutanti): se esiste già non viene toccato, e se lo elimini non
  viene ricreato.

## [0.3.0] — 2026-10-14
### Aggiunto
- **Automazioni create con un tocco.** Quando chiedi un'automazione (nuova o la modifica di
  una esistente) Claude prepara una **bozza**: in chat compare una scheda con la
  spiegazione, i controlli superati, lo YAML e, per le modifiche, le **differenze** rispetto
  alla versione attuale. Premi **Crea automazione** (o **Applica modifica**) e l'add-on la
  scrive in Home Assistant con la stessa API dell'editor; oppure **Scarta**. Si può anche
  **creare disattivata**.
- **Controlli prima della scheda**: YAML senza `!secret`/`!include`, sintassi aggiornata
  in automatico (`trigger:`, `action:`, chiavi al plurale), entità, aree, dispositivi e
  servizi esistenti, validazione di Home Assistant. Se qualcosa non va la bozza non viene
  mostrata e Claude la corregge da solo.
- **Annulla**: elimina l'automazione appena creata o ripristina la versione precedente
  (salvata in un backup nell'add-on). Se nel frattempo l'hai modificata a mano, chiede
  conferma prima di sovrascrivere.
- **Apri nell'editor**: porta direttamente all'automazione nell'editor di Home Assistant.
- Le automazioni create dall'assistente ricevono la categoria **"Claude"**.
- **Impostazioni → Modifiche fatte dall'assistente**: cronologia di creazioni, modifiche e
  ripristini, con chi li ha confermati.
- Claude sa cosa hai fatto con le sue bozze (applicata, scartata, annullata) dal messaggio
  successivo, senza che tu debba dirlo.
### Sicurezza
- Claude non scrive mai in Home Assistant: prepara solo bozze, e scrive l'add-on dopo il
  tuo tocco, ricontrollando tutto in quel momento.
- **Doppia conferma** per le automazioni che comandano serrature, apriporta, allarmi,
  sirene, valvole, garage e cancelli, citofono, o che pubblicano su MQTT.
- Servizi mai ammessi nelle automazioni proposte: `shell_command`, `python_script`,
  `rest_command`, `command_line`, `hassio`, riavvio/arresto di Home Assistant, pulizia del
  recorder, installazione di aggiornamenti; vietati anche i nomi di servizio a template.
- Se l'automazione è stata modificata da qualcun altro dopo la proposta, la modifica viene
  rifiutata invece di sovrascrivere. Se dopo il salvataggio Home Assistant non riesce a
  caricarla, l'add-on torna subito alla versione precedente.
### Corretto
- Lo YAML mostrato mette tra virgolette valori come `"on"`, `"off"` e `"00:10:00"`: incollato
  nell'editor di Home Assistant significa esattamente la stessa cosa.
### Note
- Le chat aperte con la 0.2 continuano a funzionare in sola lettura; per le bozze apri una
  nuova chat.

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
