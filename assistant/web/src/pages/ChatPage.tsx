import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  AlertTriangle,
  ArrowUp,
  Check,
  Copy,
  History,
  Info,
  Loader2,
  MessageCirclePlus,
  Square,
  Trash2,
  Wrench,
  X,
} from 'lucide-react'
import { api, ApiCallError, type ConversationDetail, type ConversationSummary, type Session, type ViewItem, type ViewPart } from '../api'
import { GlassCard } from '../components/Glass'
import { t } from '../i18n/it'

// Chat con Claude: elenco delle conversazioni, risposte in streaming via SSE (il turno gira
// sul server: se la pagina si ricarica, si riaggancia), chip degli strumenti, Stop.

const SUGGESTIONS = [
  'Quali luci sono accese adesso?',
  'Com’è andata la temperatura in casa nelle ultime 24 ore?',
  'Quali automazioni non sono mai scattate negli ultimi giorni?',
  'Perché un’automazione non è scattata ieri sera? Ti dico quale.',
]

type LiveState = { parts: ViewPart[]; thinking: boolean; pendingTool: string | null }

const usd = (n: number) => (n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`)

function CodeBlock({ children }: { children?: React.ReactNode }) {
  const ref = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    const text = ref.current?.innerText ?? ''
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Nell'iframe dell'ingress la Clipboard API può essere negata: selezione manuale.
      const range = document.createRange()
      if (ref.current) {
        range.selectNodeContents(ref.current)
        getSelection()?.removeAllRanges()
        getSelection()?.addRange(range)
        document.execCommand('copy')
      }
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="as-code">
      <button type="button" className="as-code-copy" onClick={() => void copy()} aria-label={t('chatCopy')}>
        {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? t('chatCopied') : t('chatCopy')}
      </button>
      <pre ref={ref}>{children}</pre>
    </div>
  )
}

const mdComponents: Components = {
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="as-table-wrap">
      <table>{children}</table>
    </div>
  ),
}

function Markdown({ text }: { text: string }) {
  return (
    <div className="as-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {text}
      </ReactMarkdown>
    </div>
  )
}

function ToolChip({ part }: { part: Extract<ViewPart, { type: 'tool' }> }) {
  const icon = part.ok === null ? <Loader2 size={14} className="spin" /> : part.ok ? <Wrench size={14} /> : <AlertTriangle size={14} />
  return (
    <span className={`as-chip ${part.ok === false ? 'err' : ''}`} title={part.name}>
      {icon}
      {part.label}
    </span>
  )
}

function Parts({ parts }: { parts: ViewPart[] }) {
  return (
    <>
      {parts.map((p, i) => {
        if (p.type === 'text') return <Markdown key={i} text={p.text} />
        if (p.type === 'tool') return <ToolChip key={p.id} part={p} />
        return (
          <p key={i} className={`as-note ${p.tone}`}>
            {p.tone === 'info' ? <Info size={14} /> : <AlertTriangle size={14} />} {p.text}
          </p>
        )
      })}
    </>
  )
}

function Message({ item }: { item: ViewItem }) {
  if (item.kind === 'user') {
    return (
      <div className="as-msg user">
        <div className="as-bubble">{item.text}</div>
      </div>
    )
  }
  return (
    <div className="as-msg assistant">
      <div className="as-answer">
        <Parts parts={item.parts} />
        {(item.costUsd !== undefined || item.fallback) && (
          <p className="as-meta">
            {item.costUsd !== undefined && `≈ ${usd(item.costUsd)}`}
            {item.cacheRead ? ` · ${t('chatCached')}` : ''}
            {item.fallback ? ` · ${t('chatFallback')}` : ''}
          </p>
        )}
      </div>
    </div>
  )
}

export function ChatPage({ session }: { session: Session }) {
  const [list, setList] = useState<ConversationSummary[]>([])
  const [currentId, setCurrentId] = useState<string | null>(() => sessionStorageGet('as-chat'))
  const [detail, setDetail] = useState<ConversationDetail | null>(null)
  const [pendingUser, setPendingUser] = useState<string | null>(null)
  const [live, setLive] = useState<LiveState | null>(null)
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showList, setShowList] = useState(false)
  const [budget, setBudget] = useState(session.budget)
  const esRef = useRef<EventSource | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const refreshList = useCallback(async () => {
    try {
      const r = await api.conversations()
      setList(r.conversations)
      setBudget(r.budget)
    } catch {
      // l'elenco non è essenziale
    }
  }, [])

  const loadDetail = useCallback(async (id: string) => {
    try {
      const d = await api.conversation(id)
      setDetail(d)
      return d
    } catch (e) {
      if (e instanceof ApiCallError && e.status === 404) {
        setCurrentId(null)
        setDetail(null)
      } else {
        setError(e instanceof Error ? e.message : String(e))
      }
      return null
    }
  }, [])

  const follow = useCallback(
    (id: string) => {
      esRef.current?.close()
      const es = new EventSource(api.eventsUrl(id))
      esRef.current = es
      setLive({ parts: [], thinking: false, pendingTool: null })
      const update = (fn: (s: LiveState) => LiveState) => setLive((s) => (s ? fn(s) : s))
      const on = (name: string, fn: (data: any) => void) => es.addEventListener(name, (ev) => fn(JSON.parse((ev as MessageEvent).data)))
      on('thinking', () => update((s) => ({ ...s, thinking: true })))
      on('text', ({ delta }: { delta: string }) =>
        update((s) => {
          const parts = [...s.parts]
          const last = parts[parts.length - 1]
          if (last?.type === 'text') parts[parts.length - 1] = { type: 'text', text: last.text + delta }
          else parts.push({ type: 'text', text: delta })
          return { ...s, parts, thinking: false }
        }),
      )
      // Fallback a metà risposta: il testo parziale del primo modello va scartato.
      on('fallback', () => update((s) => ({ ...s, parts: s.parts.filter((p, i) => !(p.type === 'text' && i === s.parts.length - 1)) })))
      on('tool_pending', ({ name }: { name: string }) => update((s) => ({ ...s, pendingTool: name, thinking: false })))
      on('tool', ({ id: toolId, name, label }: { id: string; name: string; label: string }) =>
        update((s) => ({ ...s, pendingTool: null, parts: [...s.parts, { type: 'tool', id: toolId, name, label, ok: null }] })),
      )
      on('tool_done', ({ id: toolId, ok }: { id: string; ok: boolean }) =>
        update((s) => ({ ...s, parts: s.parts.map((p) => (p.type === 'tool' && p.id === toolId ? { ...p, ok } : p)) })),
      )
      on('warning', ({ message }: { message: string }) => update((s) => ({ ...s, parts: [...s.parts, { type: 'note', text: message, tone: 'warning' }] })))
      on('error', ({ message }: { message: string }) => update((s) => ({ ...s, parts: [...s.parts, { type: 'note', text: message, tone: 'error' }] })))
      const finish = async () => {
        es.close()
        if (esRef.current === es) esRef.current = null
        await loadDetail(id)
        setLive(null)
        setPendingUser(null)
        void refreshList()
      }
      on('done', () => void finish())
      on('idle', () => void finish())
      // In caso di errore di rete EventSource si ricollega da solo con Last-Event-ID.
    },
    [loadDetail, refreshList],
  )

  useEffect(() => {
    void refreshList()
    return () => esRef.current?.close()
  }, [refreshList])

  useEffect(() => {
    sessionStorageSet('as-chat', currentId)
    setDetail(null)
    setLive(null)
    setPendingUser(null)
    esRef.current?.close()
    if (!currentId) return
    void loadDetail(currentId).then((d) => {
      if (d?.running) follow(currentId)
    })
  }, [currentId, loadDetail, follow])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [detail, live, pendingUser])

  const send = async (raw: string) => {
    const text = raw.trim()
    if (!text || busy || live) return
    setError(null)
    setBusy(true)
    try {
      let id = currentId
      if (!id) {
        const created = await api.createConversation()
        id = created.id
        setCurrentId(id)
        await loadDetail(id)
      }
      setPendingUser(text)
      setInput('')
      await api.send(id, text)
      follow(id)
    } catch (e) {
      setPendingUser(null)
      setInput(text)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const newChat = async () => {
    setShowList(false)
    setError(null)
    setBusy(true)
    try {
      const created = await api.createConversation()
      setCurrentId(created.id)
      void refreshList()
      inputRef.current?.focus()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    if (!confirm(t('chatDeleteConfirm'))) return
    try {
      await api.deleteConversation(id)
      if (id === currentId) setCurrentId(null)
      void refreshList()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send(input)
    }
  }

  if (!session.options.anthropicConfigured) {
    return (
      <GlassCard className="as-center-card">
        <p className="text-body">{t('diagAnthropicMissing')}</p>
      </GlassCard>
    )
  }

  const items = detail?.items ?? []
  const running = Boolean(live)
  const empty = items.length === 0 && !pendingUser && !live

  return (
    <div className={`as-chat ${showList ? 'show-list' : ''}`}>
      <aside className="as-chat-list glass-panel" aria-label={t('chatHistory')}>
        <div className="as-chat-list-head">
          <button type="button" className="glass-btn glass-btn-accent as-btn" onClick={() => void newChat()} disabled={busy}>
            <MessageCirclePlus size={16} /> {t('chatNew')}
          </button>
          <button type="button" className="as-icon-btn as-only-narrow" onClick={() => setShowList(false)} aria-label={t('close')}>
            <X size={18} />
          </button>
        </div>
        <ul className="glass-scroll">
          {list.length === 0 && <li className="as-chat-list-empty">{t('chatNoHistory')}</li>}
          {list.map((c) => (
            <li key={c.id} className={c.id === currentId ? 'active' : ''}>
              <button
                type="button"
                className="as-chat-item"
                onClick={() => {
                  setCurrentId(c.id)
                  setShowList(false)
                }}
              >
                <span className="as-chat-item-title">{c.title}</span>
                <span className="as-chat-item-meta">
                  {new Date(c.updatedAt).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · {usd(c.costUsd)}
                </span>
              </button>
              <button type="button" className="as-icon-btn" onClick={() => void remove(c.id)} aria-label={t('chatDelete')}>
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="as-chat-main">
        <div className="as-chat-bar">
          <button type="button" className="as-icon-btn as-only-narrow" onClick={() => setShowList(true)} aria-label={t('chatHistory')}>
            <History size={18} />
          </button>
          <div className="as-chat-bar-title">
            <strong>{detail?.summary.title ?? t('chatNewTitle')}</strong>
            {detail && (
              <span>
                {detail.model} · effort {detail.effort} · {detail.inventoryStats.included} {t('chatEntities')}
              </span>
            )}
          </div>
          <button type="button" className="as-icon-btn" onClick={() => void newChat()} disabled={busy || running} aria-label={t('chatNew')} title={t('chatNew')}>
            <MessageCirclePlus size={18} />
          </button>
        </div>

        {budget && budget.level !== 'ok' && (
          <p className={`as-note ${budget.level === 'bloccato' ? 'error' : 'warning'} as-chat-banner`}>
            <AlertTriangle size={14} />
            {budget.level === 'bloccato'
              ? `${t('budgetBlocked')} (${usd(budget.spentUsd)} / $${budget.blockUsd})`
              : `${t('budgetWarn')}: ${usd(budget.spentUsd)} (soglia $${budget.warnUsd})`}
          </p>
        )}

        <div className="as-chat-scroll glass-scroll">
          {empty && (
            <div className="as-chat-empty">
              <p className="text-title">{t('chatHello')}</p>
              <p className="text-body">{t('chatHelloText')}</p>
              <div className="as-suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" className="as-suggestion" onClick={() => void send(s)} disabled={busy}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {items.map((it, i) => (
            <Message key={i} item={it} />
          ))}
          {pendingUser && !items.some((it, i) => i === items.length - 1 && it.kind === 'user' && it.text === pendingUser) && (
            <Message item={{ kind: 'user', text: pendingUser, ts: '' }} />
          )}
          {live && (
            <div className="as-msg assistant">
              <div className="as-answer">
                <Parts parts={live.parts} />
                {(live.thinking || live.pendingTool || live.parts.length === 0) && (
                  <p className="as-typing">
                    <Loader2 size={14} className="spin" /> {live.pendingTool ? t('chatPreparingTool') : t('chatThinking')}
                  </p>
                )}
              </div>
            </div>
          )}
          {detail?.readOnly && <p className="as-note warning">{t('chatReadOnly')}</p>}
          <div ref={bottomRef} />
        </div>

        {error && (
          <p className="as-note error as-chat-banner">
            <AlertTriangle size={14} /> {error}
          </p>
        )}

        <form
          className="as-composer glass-panel"
          onSubmit={(e) => {
            e.preventDefault()
            void send(input)
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder={t('chatPlaceholder')}
            rows={Math.min(6, Math.max(1, input.split('\n').length))}
            maxLength={8000}
            disabled={detail?.readOnly}
            aria-label={t('chatPlaceholder')}
          />
          {running ? (
            <button type="button" className="as-send stop" onClick={() => currentId && void api.stop(currentId)} aria-label={t('chatStop')} title={t('chatStop')}>
              <Square size={16} />
            </button>
          ) : (
            <button type="submit" className="as-send" disabled={!input.trim() || busy || detail?.readOnly} aria-label={t('chatSend')} title={t('chatSend')}>
              {busy ? <Loader2 size={18} className="spin" /> : <ArrowUp size={18} />}
            </button>
          )}
        </form>
      </section>
    </div>
  )
}

// sessionStorage può essere bloccato nell'iframe (es. Safari con cookie di terze parti off).
function sessionStorageGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function sessionStorageSet(key: string, value: string | null): void {
  try {
    if (value) sessionStorage.setItem(key, value)
    else sessionStorage.removeItem(key)
  } catch {
    // ignorato
  }
}
