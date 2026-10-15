# Assistente Claude

Un assistente per Home Assistant basato su Claude (Anthropic) che:

- **chatta** con te conoscendo i dispositivi della casa e **crea automazioni** scrivendole
  direttamente in Home Assistant dopo la tua conferma (un tap, con backup e "Annulla");
- con **Suggerisci** analizza gli storici di sensori e pulsanti e propone automazioni con i
  numeri a supporto;
- con **Verifica** controlla le automazioni esistenti (riferimenti rotti, soglie mai
  raggiunte, oscillazioni, conflitti) e propone correzioni;
- **studia i dispositivi** che non conosce cercando la documentazione sul web.

> Dalla versione 0.6.0 ci sono tutte le funzioni principali: **Chat** con creazione e
> modifica delle automazioni con un tocco, **Suggerisci**, **Verifica**, **Dispositivi** e
> **Diagnostica**.

## Cosa serve

- Home Assistant OS o Supervised, versione **2026.7** o successiva.
- Una **chiave API Anthropic**. Si crea su [console.anthropic.com](https://console.anthropic.com)
  → *API Keys*. È un account a consumo, separato dall'abbonamento Claude Pro/Max (che non
  include l'accesso alle API). Consigliato: una chiave dedicata e un **limite di spesa
  mensile** impostato nella Console.

## Configurazione

| Opzione | Significato |
|---|---|
| `anthropic_api_key` | La chiave API. Resta nell'add-on: non viene mai mostrata nell'interfaccia né scritta nei log. |
| `chat_model` / `chat_effort` | Modello e livello di ragionamento della chat. Predefinito `claude-sonnet-5-5`, `medium`. |
| `analysis_model` | Modello di Suggerisci, Verifica e studio dei dispositivi. Predefinito `claude-opus-5-5`. |
| `suggest_effort` / `verify_effort` | Livello di ragionamento delle due analisi (`high` e `medium`). |
| `devices_effort` | Livello di ragionamento dello studio dei dispositivi sul web (`medium`). |
| `monthly_budget_warn_usd` / `monthly_budget_block_usd` | Spesa mensile stimata oltre la quale l'add-on avvisa e poi smette di chiamare Claude. |

## Chat

Apri il pannello **Assistente** → **Chat** e fai una domanda, per esempio:

- "Quali luci sono accese?" · "Com'è andata la temperatura in soggiorno nelle ultime 24 ore?"
- "Perché l'automazione *Luci sera* non è scattata ieri?"
- "Quali automazioni usano il sensore di presenza della cucina?"
- "Preparami un'automazione che spenga le luci quando esco di casa."

Sotto la risposta vedi quali letture ha fatto Claude (etichette) e il costo stimato.

### Creare o modificare un'automazione

Chiedilo in chat ("spegni le luci del soggiorno quando non c'è nessuno da 10 minuti",
"nell'automazione *Luci sera* aggiungi la condizione che sia buio"). Claude prepara una
**bozza** e in chat compare una scheda con:

- spiegazione e **controlli** superati (YAML, entità, servizi, validazione di HA);
- lo **YAML** e, se è una modifica, le **differenze** rispetto a ora;
- **Crea automazione** / **Applica modifica**, oppure **Scarta**; per le nuove anche
  *Crea disattivata*.

Claude non può applicare nulla da solo: scrive l'add-on dopo il tuo tocco, con la stessa
API dell'editor di Home Assistant. Dopo l'applicazione trovi **Apri nell'editor** e
**Annulla** (elimina la nuova automazione o ripristina la versione precedente, salvata in un
backup). Le automazioni create ricevono la categoria **Claude**; la cronologia è in
*Impostazioni → Modifiche fatte dall'assistente*.

Per le automazioni che comandano **serrature, apriporta, allarmi, sirene, valvole, garage
e cancelli o il citofono** serve una seconda conferma esplicita. Alcuni servizi non sono mai
ammessi (comandi di shell, script Python, chiamate REST, riavvio di Home Assistant, pulizia
del recorder, aggiornamenti). Le automazioni definite in YAML/packages o create da una
blueprint non si modificano da qui: Claude ti propone lo YAML da copiare.

Per fare prove senza toccare dispositivi veri c'è l'interruttore **Test Claude**
(`input_boolean.test_claude`), creato dall'add-on al primo avvio della 0.3.1: ad esempio
"crea un'automazione che quando accendo Test Claude mi manda una notifica persistente". Se
non ti serve eliminalo dagli Aiutanti: non verrà ricreato.

> Consiglio: prima del primo utilizzo fai un backup di Home Assistant. L'editor riscrive
> `automations.yaml` a ogni salvataggio (anche quello di HA lo fa), quindi eventuali
> commenti nel file vengono persi.

Ogni chat "fotografa" la casa all'apertura: se aggiungi dispositivi o cambi i modelli
nelle opzioni, apri una **Nuova chat**. Lo storico degli stati copre i giorni conservati
dal recorder (10 per impostazione predefinita, vedi il consiglio in *Suggerisci*); oltre,
per i sensori numerici, si usano le statistiche giornaliere.

## Suggerisci

Apri **Suggerisci**, scegli quanti giorni analizzare e premi **Analizza**. L'add-on legge il
Registro attività di Home Assistant e cerca le cose che fai **a mano** sempre allo stesso
modo. Questa parte gira tutta nell'add-on, è gratuita e richiede da pochi secondi a un paio
di minuti:

| Tipo | Esempio |
|---|---|
| Causa → effetto | luce della cucina accesa entro 30 s dal movimento, solo col buio |
| Abitudine oraria | tapparella aperta verso le 07:30 nei giorni feriali |
| Programma esterno | luce del giardino accesa ogni giorno alle 19:00 in punto da un'app |
| Dimenticato acceso | luce rimasta accesa con tutti fuori casa, o per tutta la notte |
| Pulsante | pulsante premuto spesso senza che succeda nulla |

Ogni candidato mostra i numeri che lo giustificano e alcuni **esempi** con data e ora, da
confrontare nel Registro attività di Home Assistant.

Poi premi **Fatti scrivere le automazioni** (vedi la stima del costo sul pulsante). Claude
valuta ogni candidato, sconsiglia quelli che non convincono e scrive lo YAML degli altri.
Le proposte diventano **bozze** come quelle della chat, con gli stessi controlli e gli
stessi pulsanti (*Crea automazione*, *Crea disattivata*, *Annulla*…). Inoltre:

- **Discuti in chat** apre una chat già avviata su quella proposta, per cambiarla;
- **Non mi interessa** la nasconde per 60 giorni.

Non vengono riproposti i comportamenti già coperti da un'automazione (sezione *Già
automatizzate*) né le reazioni gestite direttamente dai dispositivi, come le regole di un
bridge Hue.

Per distinguere le azioni delle persone da quelle degli strumenti (add-on, Node-RED, script
esterni che usano un loro utente) controlla **Impostazioni → Persone e strumenti**.

> Più storico, proposte migliori. Il recorder di Home Assistant conserva 10 giorni per
> impostazione predefinita. Per arrivare a 30 senza far crescere troppo il database,
> escludi le entità che cambiano di continuo e non servono alle automazioni, come il
> traffico di rete o i sensori di server e NAS. Ad esempio, in `configuration.yaml`:
>
> ```yaml
> recorder:
>   purge_keep_days: 30
>   exclude:
>     entity_globs:
>       - sensor.*_rx
>       - sensor.*_tx
> ```

## Verifica

Apri **Verifica** e premi **Controlla**. L'add-on esamina tutte le automazioni con regole
precise, senza inviare nulla a Claude: è gratuito e richiede pochi secondi.

| Regola | Cosa trova |
|---|---|
| Riferimenti | entità, dispositivi, aree o servizi che non esistono più; automazioni senza trigger o azioni |
| Stato | automazioni che Home Assistant non riesce a caricare (con il motivo) o disattivate |
| Entità senza dati | entità usate che sono "non disponibili" da più di un giorno |
| Soglie | soglie `numeric_state` mai raggiunte negli ultimi 30 giorni; stessa soglia per salire e scendere |
| Logica | `condition: trigger` con un id che nessun trigger ha; attese lunghe in `mode: single` |
| Frequenza | trigger `state` senza `to:` che scattano a ogni cambio di attributo; `time_pattern` scritti male (`minutes: "5"` è il minuto 5 di ogni ora, non "ogni 5 minuti") |
| Oscillazioni | luci o prese accese e spente a ripetizione dalla stessa automazione |
| Conflitti | due automazioni che si contraddicono; azioni corrette a mano subito dopo |
| Esecuzioni | errori, attivazioni ignorate o scartate nelle ultime tracce |
| Sintassi | forma precedente al 2024.10 (`platform:`, `service:`) |

Oscillazioni e conflitti si ricavano dal Registro attività degli ultimi giorni (7 di
default, 0 per saltarli).

Molti problemi hanno una **correzione meccanica**, ad esempio sostituire un'entità
rinominata con quella che ha lo stesso nome, aggiungere `to: null`, scrivere `"/5"` nel
`time_pattern`. Quelle **sicure** sono già spuntate; quelle **da verificare** le scegli tu.
**Prepara la correzione** crea una bozza con le differenze rispetto ad ora: la applichi con
un tocco e puoi annullarla, come in chat. Le automazioni nei file YAML, nei packages o da
blueprint non si modificano da qui: la Verifica dice cosa cambiare.

**Ignora** nasconde un problema finché non lo ripristini.

L'**analisi approfondita** è facoltativa e a pagamento (stima del costo sul pulsante). Scegli
le automazioni (di default quelle con errori o avvisi): Claude riceve configurazione,
problemi trovati, esiti delle ultime esecuzioni e attività delle entità usate, dà un giudizio
e, quando serve, propone una versione corretta come bozza. **Discuti in chat** apre una chat
già avviata sull'automazione.

## Dispositivi

Apri **Dispositivi**: c'è una voce per ogni modello presente in casa, anche quando lo stesso
oggetto arriva da più integrazioni (per esempio Matter, Bluetooth e cloud). Per ogni modello
vedi le integrazioni, con quella locale per prima, i codici modello, il firmware, i
dispositivi della casa e i tipi di entità. Restano fuori i dispositivi disattivati, i servizi
e quelli esclusi per privacy.

**Studia** fa cercare a Claude (modello di analisi) le informazioni sul web, solo su siti
fidati:

- documentazione e forum di Home Assistant;
- GitHub;
- zigbee2mqtt.io, esphome.io e Z-Wave JS;
- il sito del produttore.

Il risultato è una **scheda** con le fonti, che contiene:

- come funziona il modello e come si collega;
- entità ed eventi in Home Assistant;
- consigli per le automazioni;
- limiti noti.

Uno studio dura uno o due minuti e costa circa $0,20–0,40: il pulsante mostra la media
degli studi già fatti. Mentre lavora vedi le ricerche che sta facendo e puoi fermarlo. Nella
scheda finiscono solo pagine davvero viste durante la ricerca: l'add-on scarta gli indirizzi
inventati.

**Studia tutti** mette in coda i modelli senza scheda tra quelli mostrati: con la ricerca e
i filtri scegli quali, per esempio escludendo bridge e gruppi di altoparlanti. Prima di
partire chiede conferma, mostrando il numero di modelli, il costo e la durata stimati e la
spesa del mese. Gli studi vanno uno alla volta, anche se chiudi la pagina. La coda si ferma
con **Ferma tutto**, quando la spesa del mese raggiunge la soglia di blocco o dopo due
studi di fila non riusciti. Mentre la coda è in corso, la chat non può avviare altri studi.

Una scheda nuova è una **bozza**. Leggila e premi **Approva** se ti sembra corretta; puoi
anche rifare lo studio o eliminarla. **Approva tutte** approva insieme le bozze dei modelli
mostrati.

**Idee di automazioni**, su ogni scheda, apre una chat già avviata. Claude legge la scheda
e i tuoi dispositivi di quel modello e controlla quali automazioni li usano già. Poi propone
2–3 automazioni adatte al modello (per esempio le zone e i tempi giusti per un sensore di
presenza) e prepara la bozza di quella che scegli, da creare con un tocco come sempre. Le
idee nascono in chat e non nello studio, perché lo studio sul web non vede la casa.

In chat Claude conosce l'elenco delle schede e le legge quando la risposta dipende da come
si comporta un modello (sensori di presenza, pulsanti, prese con misura di potenza…). Quando
usa una scheda lo dice, e avverte se è ancora una bozza. Se gli chiedi esplicitamente di
studiare un dispositivo che non ha la scheda può avviare lo studio dalla chat, al massimo due
volte per conversazione.

## Impostazioni

- **Privacy**: tre categorie escluse di default, riattivabili a tuo rischio (vedi sotto).
- **Persone e strumenti**: quali utenti di Home Assistant sono persone e quali strumenti,
  per Suggerisci.
- **Cosa vede Claude**: l'inventario esatto che apre ogni nuova chat.
- **Modelli** e **spesa del mese** rispetto alle soglie di budget.

## Diagnostica

Apri **Impostazioni** → **Diagnostica**:

1. **Esegui le verifiche**: deve risultare tutto verde. Le verifiche sono solo letture.
2. **Prova lo streaming**: i 20 puntini devono riempirsi uno al secondo.
3. **Prova la connessione** a Claude: entrambi i modelli devono risultare disponibili.

## Privacy

A Claude vengono inviati solo i dati necessari alla richiesta. Per impostazione predefinita
sono esclusi:

- **posizione e GPS**: tracker, coordinate, luogo delle persone (che risultano solo "a casa"
  o "fuori casa");
- **telecamere e citofono**: telecamere, campanelli/citofoni e tutte le entità dei dispositivi
  con una telecamera (le immagini non vengono mai inviate in nessun caso);
- **app mobile e salute**: sensori dell'app Home Assistant sui telefoni e integrazioni di
  salute e fitness.

Si riattivano da **Impostazioni → Privacy**, a tuo rischio. Sempre esclusi, qualunque
scelta: token, password, chiavi, indirizzi IP e MAC, URL, numeri di serie. Gli entity_id di
entità escluse possono comparire nelle configurazioni delle automazioni che li usano, ma
stati e storici restano esclusi. Per *Suggerisci* Claude riceve solo i numeri dei
candidati: mai storici grezzi, nomi degli utenti o coordinate della casa, che servono solo
a calcolare alba e tramonto dentro l'add-on. Il controllo rapido di *Verifica* non invia
nulla; l'analisi approfondita invia la configurazione delle automazioni scelte e lo stato e
il numero di cambi delle entità che usano, con le stesse esclusioni.

Per lo **studio dei dispositivi** Claude riceve solo i dati del modello:

- produttore, modello e codici modello;
- firmware;
- integrazioni e tipi di entità;
- tipi di trigger.

Non riceve mai nomi, aree o stati dei tuoi dispositivi, quindi le ricerche sul web non
contengono nulla della casa. Le ricerche fatte restano visibili nella scheda.

Conversazioni e schede sono salvate solo nell'add-on (cartella `/data`, inclusa nei backup
di Home Assistant).

## Permessi

L'add-on usa l'API di Home Assistant con i permessi del Supervisor (amministratore), perché
deve leggere storici e tracce e, dopo la tua conferma, salvare automazioni. Il pannello è
riservato agli amministratori e l'add-on non apre porte sulla rete.
