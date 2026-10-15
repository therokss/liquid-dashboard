# Changelog

Tutte le modifiche rilevanti all'**Assistente Claude**. Formato ispirato a
[Keep a Changelog](https://keepachangelog.com/it/1.1.0/).

## [0.6.0] — 2026-10-15
### Aggiunto
- **Dispositivi**: una voce per ogni modello presente in casa, anche quando lo stesso oggetto
  arriva da più integrazioni (Matter, Bluetooth, cloud…). Per ogni modello si vedono le
  integrazioni (quella locale per prima), i codici modello, il firmware, i dispositivi e i
  tipi di entità.
- **Studia**: Claude cerca il modello sul web, solo su siti fidati (Home Assistant,
  GitHub, zigbee2mqtt, ESPHome, Z-Wave JS, produttore), e scrive una **scheda** con le
  fonti. La scheda spiega come funziona il modello, entità ed eventi, consigli per le
  automazioni e limiti noti.
  - Alla ricerca vanno solo i dati del modello: mai nomi, aree o stati.
  - Le fonti inventate vengono scartate.
  - Mentre lavora si vedono le ricerche fatte e si può fermare.
  - Il pulsante mostra il costo stimato.
- Le schede nascono come **bozza** e si **approvano** dalla pagina.
- **In chat** Claude conosce l'elenco delle schede, le legge quando servono e dice quando le
  usa. Su richiesta esplicita può studiare un modello dalla chat, al massimo due volte per
  conversazione.
- Opzione `devices_effort` per il livello di ragionamento dello studio (predefinito
  `medium`).
### Modificato
- Il costo stimato comprende anche le ricerche web ($10 ogni 1000).
- `info_dispositivo` in chat indica se il modello ha una scheda.

## [0.5.0] — 2026-10-15
### Aggiunto
- **Verifica**: controllo rapido e gratuito di tutte le automazioni, fatto dall'add-on con
  regole precise e senza inviare nulla a Claude. Trova:
  - riferimenti rotti: entità, dispositivi, aree e servizi che non esistono più;
  - automazioni non caricate, con il motivo dato da Home Assistant, e automazioni spente;
  - entità usate che non danno dati da più di un giorno;
  - soglie mai raggiunte negli ultimi 30 giorni e soglie identiche per salire e scendere;
  - condizioni su id di trigger inesistenti, compresi gli id "incollati" come "530" al posto
    di "5" e "30";
  - trigger che scattano troppo spesso: `state` senza `to:` sui sensori che cambiano
    attributi di continuo, e `time_pattern` come `minutes: "5"` (una volta all'ora) quando
    il nome dice "ogni 5 minuti";
  - oscillazioni, automazioni in conflitto e azioni corrette a mano subito dopo, dal
    Registro attività;
  - errori e attivazioni scartate nelle ultime esecuzioni;
  - sintassi precedente al 2024.10.
- **Correzioni con un tocco** per i casi meccanici: entità rinominata sostituita con quella
  che ha lo stesso nome, `to: null`, intervallo `"/N"` nel `time_pattern`, id dei trigger
  separati, sintassi aggiornata. Diventano una bozza con le differenze, si applicano e si
  annullano come quelle della chat. Le correzioni sicure sono già spuntate.
- **Analisi approfondita** facoltativa, con la stima del costo: Claude (modello di analisi)
  giudica le automazioni scelte, a gruppi di 5, e propone le correzioni come bozze.
- Per ogni automazione: **Ignora** un problema, **Discuti in chat**, **Apri nell'editor**.
### Modificato
- Le bozze di modifica non vengono più bloccate da problemi che l'automazione aveva già
  (ad esempio un altro riferimento rotto): diventano avvisi.
- I controlli delle bozze riconoscono le entità indicate per id di registro nei blocchi di
  tipo dispositivo e accettano `initial_state`.

## [0.4.0] — 2026-10-14
### Aggiunto
- **Suggerisci**: l'add-on legge il Registro attività degli ultimi 7, 14 o 30 giorni e trova
  le cose che fai a mano sempre allo stesso modo:
  - **causa → effetto**, ad esempio la luce accesa a mano entro mezzo minuto dal movimento,
    con l'eventuale condizione che la rende affidabile (buio, poca luce in stanza, fascia
    oraria);
  - **abitudini orarie**, separate tra giorni feriali e fine settimana o festivi, e legate al
    tramonto o all'alba quando sono più regolari così;
  - **programmi esterni**: azioni alla stessa ora esatta ogni giorno, fatte da app o
    dispositivi e non da Home Assistant;
  - **dispositivi dimenticati accesi** con la casa vuota o per tutta la notte;
  - **pulsanti** premuti senza nessun effetto.

  Ogni proposta mostra i suoi numeri ("20 volte su 20, di solito dopo 20 s") e alcuni
  esempi con data e ora da confrontare nel Registro attività.
- L'analisi è **locale e gratuita**. Poi, se vuoi, premi **Fatti scrivere le
  automazioni** (con la stima del costo): Claude (modello di analisi) valuta ogni candidato
  e scrive lo YAML, oppure lo sconsiglia spiegando perché. Le proposte diventano le stesse
  **bozze** della chat, con gli stessi controlli, e se una non li supera Claude la corregge
  una volta.
- Per ogni proposta:
  - **Discuti in chat** apre una nuova chat già avviata su quella proposta;
  - **Non mi interessa** la nasconde per 60 giorni.
- I comportamenti già coperti da un'automazione non vengono riproposti: compaiono in
  **Già automatizzate**, da rivedere con Verifica.
- **Impostazioni → Persone e strumenti**: indica quali utenti di Home Assistant sono
  persone e quali strumenti (add-on, Node-RED…). Solo le azioni delle persone contano come
  abitudini.
### Modificato
- La chat non dà più per scontati 10 giorni di storico: si adatta a quanti ne conserva il
  recorder.
### Privacy
- A Claude arrivano solo i numeri dei candidati: niente storici grezzi, nomi degli utenti o
  coordinate della casa. Le coordinate servono solo a calcolare alba e tramonto dentro
  l'add-on.

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
