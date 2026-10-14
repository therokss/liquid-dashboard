declare const __VERSION__: string | undefined

/** Versione dell'add-on, iniettata in build da claude_assistant/config.yaml (unica fonte). */
export const VERSION: string = typeof __VERSION__ === 'string' ? __VERSION__ : 'dev'
