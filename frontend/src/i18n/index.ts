import { useStore } from '../store'
import it from './it'
import en from './en'
import es from './es'

export type Lang = 'it' | 'en' | 'es'

const DICTS: Record<Lang, Record<string, string>> = { it, en, es }

export function t(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const raw = DICTS[lang]?.[key] ?? key
  if (!vars) return raw
  let out = raw
  for (const k of Object.keys(vars)) out = out.split(`{{${k}}}`).join(String(vars[k]))
  return out
}

export function useT(): (key: string, vars?: Record<string, string | number>) => string {
  const lang = useStore((s) => s.language)
  return (key, vars) => t(lang, key, vars)
}
