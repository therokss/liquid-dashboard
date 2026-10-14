import type { HAReader } from '../ha/data.ts'
import type { HelperWriter } from '../ha/writer.ts'
import type { SettingsStore } from '../store/settings.ts'
import { log } from '../log.ts'

// Interruttore di prova per collaudare le bozze senza toccare dispositivi veri. L'add-on lo
// crea UNA volta (aiutante dell'interfaccia, eliminabile da Impostazioni → Aiutanti); se
// esiste già o l'utente lo elimina, non viene più ricreato.

export const TEST_HELPER_ID = 'input_boolean.test_claude'
const NAME = 'Test Claude'
const ICON = 'mdi:robot-outline'

export type TestHelperOutcome = 'creato' | 'esistente' | 'gia_gestito' | 'errore'

let inFlight: Promise<TestHelperOutcome> | null = null

/** Riconnessioni ravvicinate non devono creare due interruttori (test_claude e test_claude_2). */
export function ensureTestHelper(deps: { ha: HAReader; writer: HelperWriter; settings: SettingsStore }): Promise<TestHelperOutcome> {
  inFlight ??= run(deps).finally(() => {
    inFlight = null
  })
  return inFlight
}

async function run(deps: { ha: HAReader; writer: HelperWriter; settings: SettingsStore }): Promise<TestHelperOutcome> {
  if (deps.settings.get().testHelper) return 'gia_gestito'
  try {
    const [states, registries] = await Promise.all([deps.ha.states(), deps.ha.registries()])
    if (states.has(TEST_HELPER_ID) || registries.entities.some((e) => e.entity_id === TEST_HELPER_ID)) {
      await deps.settings.setTestHelper('esistente')
      return 'esistente'
    }
    await deps.writer.createInputBoolean(NAME, ICON)
    await deps.settings.setTestHelper('creato')
    log.info(`Creato l'interruttore di prova ${TEST_HELPER_ID} (Impostazioni → Dispositivi e servizi → Aiutanti)`)
    return 'creato'
  } catch (err) {
    // Si riproverà al prossimo avvio o alla prossima riconnessione.
    log.warn(`Interruttore di prova ${TEST_HELPER_ID} non creato`, err instanceof Error ? err.message : err)
    return 'errore'
  }
}
