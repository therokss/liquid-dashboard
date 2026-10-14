# Assistente Claude

Un assistente per Home Assistant basato su Claude (Anthropic) che:

- **chatta** con te conoscendo i dispositivi della casa e **crea automazioni** scrivendole
  direttamente in Home Assistant dopo la tua conferma (un tap, con backup e "Annulla");
- con **Suggerisci** analizza gli storici di sensori e pulsanti e propone automazioni con i
  numeri a supporto;
- con **Verifica** controlla le automazioni esistenti (riferimenti rotti, soglie mai
  raggiunte, oscillazioni, conflitti) e propone correzioni;
- **studia i dispositivi** che non conosce cercando la documentazione sul web.

> Versione 0.1.0: per ora c'è la **Diagnostica**, che verifica che tutto il necessario
> funzioni sulla tua installazione. Le altre funzioni arrivano nelle versioni successive.

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

## Diagnostica

Apri il pannello **Assistente** → scheda **Diagnostica**:

1. **Esegui le verifiche**: deve risultare tutto verde. Le verifiche sono solo letture.
2. **Prova lo streaming**: i 20 puntini devono riempirsi uno al secondo.
3. **Prova la connessione** a Claude: entrambi i modelli devono risultare disponibili.

## Privacy

A Claude vengono inviati solo i dati necessari alla richiesta. Per impostazione predefinita
sono esclusi posizioni GPS, telecamere e citofono, dati delle app companion e di salute;
potrai riattivarli dalle impostazioni dell'assistente, a tuo rischio.

## Permessi

L'add-on usa l'API di Home Assistant con i permessi del Supervisor (amministratore), perché
deve leggere storici e tracce e, dopo la tua conferma, salvare automazioni. Il pannello è
riservato agli amministratori e l'add-on non apre porte sulla rete.
