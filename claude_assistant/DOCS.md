# Assistente Claude

Un assistente per Home Assistant basato su Claude (Anthropic) che:

- **chatta** con te conoscendo i dispositivi della casa e **crea automazioni** scrivendole
  direttamente in Home Assistant dopo la tua conferma (un tap, con backup e "Annulla");
- con **Suggerisci** analizza gli storici di sensori e pulsanti e propone automazioni con i
  numeri a supporto;
- con **Verifica** controlla le automazioni esistenti (riferimenti rotti, soglie mai
  raggiunte, oscillazioni, conflitti) e propone correzioni;
- **studia i dispositivi** che non conosce cercando la documentazione sul web.

> Versione 0.2.0: c'è la **Chat in sola lettura** (Claude conosce la casa, legge stati,
> storici e automazioni e prepara lo YAML da incollare) e la **Diagnostica**. Creazione con
> un tap, Suggerisci, Verifica e studio dei dispositivi arrivano nelle versioni successive.

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
| `monthly_budget_warn_usd` / `monthly_budget_block_usd` | Spesa mensile stimata oltre la quale l'add-on avvisa e poi smette di chiamare Claude. |

## Chat

Apri il pannello **Assistente** → **Chat** e fai una domanda, per esempio:

- "Quali luci sono accese?" · "Com'è andata la temperatura in soggiorno nelle ultime 24 ore?"
- "Perché l'automazione *Luci sera* non è scattata ieri?"
- "Quali automazioni usano il sensore di presenza della cucina?"
- "Preparami un'automazione che spenga le luci quando esco di casa."

Sotto la risposta vedi quali letture ha fatto Claude (etichette) e il costo stimato. In
questa versione l'assistente **non modifica nulla**: lo YAML proposto si copia con
**Copia** e si incolla in *Impostazioni → Automazioni e scene → Crea automazione → ⋮ →
Modifica in YAML*.

Ogni chat "fotografa" la casa all'apertura: se aggiungi dispositivi o cambi i modelli
nelle opzioni, apri una **Nuova chat**. Lo storico degli stati copre i giorni conservati
dal recorder (10 per impostazione predefinita); oltre, per i sensori numerici, si usano le
statistiche giornaliere.

## Impostazioni

- **Privacy**: tre categorie escluse di default, riattivabili a tuo rischio (vedi sotto).
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
stati e storici restano esclusi. Le conversazioni sono salvate solo nell'add-on (cartella
`/data`, inclusa nei backup di Home Assistant).

## Permessi

L'add-on usa l'API di Home Assistant con i permessi del Supervisor (amministratore), perché
deve leggere storici e tracce e, dopo la tua conferma, salvare automazioni. Il pannello è
riservato agli amministratori e l'add-on non apre porte sulla rete.
