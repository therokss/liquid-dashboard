// Capacità note dei modelli: cosa si può inviare senza tentativi. Le altre funzioni opzionali
// si scoprono dal vivo (un 400 le spegne) e la memoria resta separata per modello: il rifiuto
// di un modello non deve spegnerle per gli altri.

/** Fallback lato server dopo un rifiuto: Haiku 5.5 non li ha (docs, Migrating to Claude Haiku 5.5). */
export function supportsServerFallback(model: string): boolean {
  return !model.startsWith('claude-haiku-')
}

export interface FallbackFeatures {
  fallbacks: boolean
}

export class FeatureMemory {
  private readonly byModel = new Map<string, FallbackFeatures>()

  for(model: string): FallbackFeatures {
    let f = this.byModel.get(model)
    if (!f) this.byModel.set(model, (f = { fallbacks: supportsServerFallback(model) }))
    return f
  }
}
