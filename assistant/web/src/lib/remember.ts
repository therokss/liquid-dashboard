import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

// "Dov'eri": quando esci dal pannello Home Assistant chiude l'iframe e al rientro lo ricarica
// senza hash, quindi sezione, conversazione, filtri e scorrimento si salvano qui. localStorage
// sopravvive anche alla chiusura dell'app; se è bloccato (Safari con i dati di terze parti
// spenti) si ripiega su sessionStorage e, al peggio, si riparte dall'inizio.

const PREFIX = 'assistente.'

function stores(): Storage[] {
  const out: Storage[] = []
  for (const get of [() => localStorage, () => sessionStorage]) {
    try {
      out.push(get())
    } catch {
      // archiviazione non disponibile
    }
  }
  return out
}

export function recall(key: string): string | null {
  for (const s of stores()) {
    try {
      const v = s.getItem(PREFIX + key)
      if (v !== null) return v
    } catch {
      // prova la successiva
    }
  }
  return null
}

export function remember(key: string, value: string | null): void {
  for (const s of stores()) {
    try {
      if (value === null) s.removeItem(PREFIX + key)
      else s.setItem(PREFIX + key, value)
      return
    } catch {
      // prova la successiva
    }
  }
}

/** useState che si ricorda il valore; con `allowed` un valore salvato non più valido si ignora. */
export function useRemembered<T extends string | boolean | null>(key: string, initial: T, allowed?: readonly T[]): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const raw = recall(key)
    if (raw === null) return initial
    try {
      const parsed = JSON.parse(raw) as T
      if (typeof parsed !== typeof initial && !(initial === null || parsed === null)) return initial
      return !allowed || allowed.includes(parsed) ? parsed : initial
    } catch {
      // Valore salvato come testo semplice dalle versioni precedenti (es. la scheda di Dispositivi).
      return allowed?.includes(raw as T) ? (raw as T) : initial
    }
  })
  const set = useCallback(
    (next: T) => {
      setValue(next)
      remember(key, next === initial ? null : JSON.stringify(next))
    },
    [key, initial],
  )
  return [value, set]
}

/**
 * Ricorda lo scorrimento di un contenitore per chiave (es. una sezione) e lo ripristina al
 * rientro. Il contenuto arriva dopo (dati caricati dal server): si riprova per qualche secondo
 * finché la pagina è abbastanza lunga, e ci si ferma appena l'utente tocca o scorre.
 */
export function useScrollMemory(ref: RefObject<HTMLElement | null>, key: string | null): void {
  const restoring = useRef(false)
  useEffect(() => {
    const el = ref.current
    if (!el || !key) return
    const target = Number(recall(`scorrimento.${key}`)) || 0
    restoring.current = target > 0
    el.scrollTop = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const started = Date.now()
    const stop = () => {
      restoring.current = false
      if (timer) clearTimeout(timer)
    }
    const step = () => {
      if (!restoring.current) return
      el.scrollTop = target
      if (Math.abs(el.scrollTop - target) < 2 || Date.now() - started > 4000) stop()
      else timer = setTimeout(step, 120)
    }
    if (target > 0) step()
    // Si salva mentre si scorre (al più ogni 150 ms, più l'ultima posizione): quando esci dal
    // pannello l'iframe sparisce senza preavviso.
    let saveTimer: ReturnType<typeof setTimeout> | undefined
    let lastSave = 0
    const save = () => {
      lastSave = Date.now()
      remember(`scorrimento.${key}`, el.scrollTop > 0 ? String(Math.round(el.scrollTop)) : null)
    }
    const onScroll = () => {
      if (restoring.current) return
      if (saveTimer) clearTimeout(saveTimer)
      if (Date.now() - lastSave > 150) save()
      else saveTimer = setTimeout(save, 150)
    }
    const interrupt = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
    interrupt.forEach((ev) => el.addEventListener(ev, stop, { passive: true }))
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      stop()
      if (saveTimer) clearTimeout(saveTimer)
      interrupt.forEach((ev) => el.removeEventListener(ev, stop))
      el.removeEventListener('scroll', onScroll)
    }
  }, [ref, key])
}
