// Testi dell'interfaccia: l'italiano è la lingua base, le chiavi sono tipizzate.
export const it = {
  appTitle: 'Assistente Claude',
  loading: 'Caricamento…',
  sessionError: "Impossibile contattare l'add-on",
  noAccess: 'Accesso riservato agli amministratori di Home Assistant',
  tabChat: 'Chat',
  tabSuggest: 'Suggerisci',
  tabVerify: 'Verifica',
  tabDevices: 'Dispositivi',
  tabDiagnostics: 'Diagnostica',
  comingSoon: 'In arrivo',
  comingChat: 'Chat con Claude che conosce la casa e scrive le automazioni con un tap.',
  comingSuggest: 'Analizza gli storici di sensori e pulsanti e propone automazioni con i numeri a supporto.',
  comingVerify: 'Controlla le automazioni esistenti: riferimenti rotti, soglie mai raggiunte, oscillazioni, conflitti.',
  comingDevices: 'Scheda di ogni modello di dispositivo, con studio sul web di quelli sconosciuti.',
  plannedIn: 'Prevista nella versione',
  diagTitle: 'Diagnostica',
  diagIntro: 'Verifica in sola lettura che l’add-on possa usare tutte le API di Home Assistant e di Claude. Non modifica nulla.',
  diagHa: 'Home Assistant',
  diagRun: 'Esegui le verifiche',
  diagRunning: 'Verifiche in corso…',
  diagSummary: 'superate',
  diagSse: 'Streaming verso il browser',
  diagSseIntro: 'Il server invia un evento al secondo per 20 secondi: devono arrivare uno alla volta, non a blocchi.',
  diagSseRun: 'Prova lo streaming',
  diagSseOk: 'Streaming regolare',
  diagSseBuffered: 'Eventi arrivati a blocchi: qualcosa lungo la strada bufferizza',
  diagSseMaxGap: 'intervallo massimo',
  diagAnthropic: 'API di Claude',
  diagAnthropicIntro: 'Controlla chiave e modelli senza generare testo (costo zero).',
  diagAnthropicRun: 'Prova la connessione',
  diagAnthropicMissing: "Chiave API non configurata: inseriscila nelle opzioni dell'add-on (Impostazioni → Componenti aggiuntivi → Assistente Claude → Configurazione).",
  diagTokens: 'token di prova contati',
  infoVersion: 'Versione',
  infoMode: 'Modalità',
  infoHa: 'Home Assistant',
  infoChatModel: 'Modello chat',
  infoAnalysisModel: 'Modello analisi',
  infoUser: 'Utente',
} as const

export type TextKey = keyof typeof it

export function t(key: TextKey): string {
  return it[key]
}
