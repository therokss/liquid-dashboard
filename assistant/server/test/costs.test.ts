import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { budgetBlockedMessage, budgetRaiseHint, budgetThresholds, planCreditUsd, UsageLedger, usageRecord } from '../src/claude/usage.ts'
import { FeatureMemory, supportsServerFallback } from '../src/claude/models.ts'
import { buildStructuredParams } from '../src/claude/structured.ts'
import { DEFAULT_OPTIONS, parseOptions, type Options } from '../src/options.ts'
import { nextPeriodStart, periodKey, periodStart } from '../src/util/time.ts'

const TZ = 'Europe/Rome'

test('piano: opzioni, crediti inclusi e soglie del budget', () => {
  const o = parseOptions({ claude_plan: 'max_5x', billing_day: 15 })
  assert.equal(o.plan, 'max_5x')
  assert.equal(o.billingDay, 15)
  assert.equal(parseOptions({ claude_plan: 'gratis', billing_day: 31 }).plan, 'api')
  assert.equal(parseOptions({ billing_day: 31 }).billingDay, 31)
  assert.equal(parseOptions({ billing_day: 45 }).billingDay, 31)
  assert.equal(parseOptions({ billing_day: 0 }).billingDay, 1)
  assert.equal(parseOptions({ claude_plan: 'team', team_credits_usd: 900 }).teamCreditsUsd, 500)

  assert.equal(planCreditUsd({ plan: 'max_5x', teamCreditsUsd: 0 }), 100)
  assert.equal(planCreditUsd({ plan: 'max_20x', teamCreditsUsd: 0 }), 200)
  assert.equal(planCreditUsd({ plan: 'pro', teamCreditsUsd: 0 }), 0)
  assert.equal(planCreditUsd({ plan: 'team', teamCreditsUsd: 260 }), 260)

  // Soglie predefinite + crediti: avviso all'80%, blocco quando finiscono.
  assert.deepEqual(budgetThresholds(o), { warn: 80, block: 100, warnFromCredits: true, blockFromCredits: true })
  // Le soglie si decidono una per una: un blocco proprio porta l'avviso all'80% di quello…
  assert.deepEqual(budgetThresholds({ ...o, monthlyBudgetBlockUsd: 60 }), { warn: 48, block: 60, warnFromCredits: true, blockFromCredits: false })
  // …e spegnere l'avviso non riporta il blocco a 50 $.
  assert.deepEqual(budgetThresholds({ ...o, monthlyBudgetWarnUsd: 0 }), { warn: 0, block: 100, warnFromCredits: false, blockFromCredits: true })
  assert.deepEqual(budgetThresholds({ ...o, monthlyBudgetBlockUsd: 0 }), { warn: 80, block: 0, warnFromCredits: true, blockFromCredits: false })
  // API a consumo, Pro e Team senza credito: le soglie delle opzioni.
  const own = { warn: 25, block: 50, warnFromCredits: false, blockFromCredits: false }
  assert.deepEqual(budgetThresholds(DEFAULT_OPTIONS), own)
  assert.deepEqual(budgetThresholds({ ...DEFAULT_OPTIONS, plan: 'pro' }), own)
  assert.deepEqual(budgetThresholds({ ...DEFAULT_OPTIONS, plan: 'team' }), own)
})

test('periodo di spesa: mese di calendario o ciclo di fatturazione', () => {
  assert.equal(periodKey(new Date('2026-10-14T10:00:00Z'), TZ, 1), '2026-10')
  assert.equal(periodKey(new Date('2026-10-14T10:00:00Z'), TZ, 15), '2026-09')
  assert.equal(periodKey(new Date('2026-10-15T10:00:00Z'), TZ, 15), '2026-10')
  assert.equal(periodKey(new Date('2026-01-03T10:00:00Z'), TZ, 5), '2025-12')
  // Mezzanotte locale, non UTC: il 14 alle 23:30 UTC a Roma è già il 15.
  assert.equal(periodKey(new Date('2026-10-14T23:30:00Z'), TZ, 15), '2026-10')
  // Rinnovo dal 29 al 31: nei mesi più corti il ciclo parte l'ultimo giorno.
  assert.equal(periodKey(new Date('2026-02-27T10:00:00Z'), TZ, 31), '2026-01')
  assert.equal(periodKey(new Date('2026-02-28T10:00:00Z'), TZ, 31), '2026-02')
  assert.equal(periodKey(new Date('2026-03-30T10:00:00Z'), TZ, 31), '2026-02')
  assert.equal(periodKey(new Date('2026-04-30T10:00:00Z'), TZ, 31), '2026-04')
  assert.equal(periodKey(new Date('2028-02-28T10:00:00Z'), TZ, 30), '2028-01')
  assert.equal(periodKey(new Date('2028-02-29T10:00:00Z'), TZ, 30), '2028-02')
  assert.equal(periodKey(new Date('2026-01-15T10:00:00Z'), TZ, 31), '2025-12')
  // Quando si toglie un blocco.
  assert.equal(nextPeriodStart(new Date('2026-10-20T10:00:00Z'), TZ, 1), '2026-11-01')
  assert.equal(nextPeriodStart(new Date('2026-10-20T10:00:00Z'), TZ, 31), '2026-10-31')
  assert.equal(nextPeriodStart(new Date('2026-10-31T10:00:00Z'), TZ, 31), '2026-11-30')
  assert.equal(nextPeriodStart(new Date('2026-12-20T10:00:00Z'), TZ, 15), '2027-01-15')
  assert.equal(nextPeriodStart(new Date('2027-01-31T10:00:00Z'), TZ, 31), '2027-02-28')
  // Da quando: settembre ha 30 giorni.
  assert.equal(periodStart(new Date('2026-10-20T10:00:00Z'), TZ, 31), '2026-09-30')
  assert.equal(periodStart(new Date('2026-10-20T10:00:00Z'), TZ, 15), '2026-10-15')
  assert.equal(periodStart(new Date('2026-10-20T10:00:00Z'), TZ, 1), '2026-10-01')
})

test('registro: spesa per ciclo, soglie dai crediti, ripartizione per funzione e modello', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'assistente-costi-'))
  let now = new Date('2026-10-10T10:00:00Z')
  const ledger = new UsageLedger(dir, () => TZ, () => now)
  await ledger.load()
  const opts: Options = { ...DEFAULT_OPTIONS, plan: 'max_5x', billingDay: 15 }
  const u = (model: string, costUsd: number, cacheRead = 0) => ({ model, input: 1000, output: 100, cacheRead, cacheWrite: 0, costUsd, fallback: false })
  await ledger.record(usageRecord('chat', 'c1', u('claude-sonnet-5-5', 70), { step: 'turno', effort: 'medium' }))
  now = new Date('2026-10-16T10:00:00Z') // nuovo ciclo dal 15
  await ledger.record(usageRecord('chat', 'c2', u('claude-sonnet-5-5', 1, 3000), { step: 'turno', effort: 'medium' }))
  await ledger.record(usageRecord('chat', 'c2', u('claude-sonnet-5-5', 2, 1000)))
  await ledger.record(usageRecord('verify', 'v1', { ...u('claude-opus-5-5', 5), cacheWrite1h: 0 }, { step: 'analisi', effort: 'medium' }))

  const s = ledger.status(opts)
  assert.equal(s.month, '2026-10')
  assert.equal(s.spentUsd, 8)
  assert.equal(s.creditUsd, 100)
  assert.equal(s.blockFromCredits, true)
  assert.equal(s.blockUsd, 100)
  assert.equal(s.level, 'ok')
  assert.equal(s.startsOn, '2026-10-15')
  assert.equal(s.resetsOn, '2026-11-15')
  // Mese di calendario: anche la voce del 10/10 (il periodo di ogni voce si ricalcola).
  const cal = ledger.status({ ...opts, plan: 'api', billingDay: 1 })
  assert.equal(cal.spentUsd, 78)
  assert.equal(cal.level, 'bloccato')
  assert.equal(budgetBlockedMessage(cal), "Budget raggiunto ($78.00 su $50): l'add-on torna a chiamare Claude il 01/11/2026.")
  assert.equal(budgetRaiseHint(cal), 'Puoi alzare la soglia nelle opzioni.')
  assert.match(budgetRaiseHint({ ...cal, blockFromCredits: true, blockUsd: 100 }), /oltre \$100/)
  assert.equal(ledger.status(opts).spentUsd, 8)
  // Una voce nuova entra subito nel conto.
  await ledger.record(usageRecord('chat', 'c3', u('claude-sonnet-5-5', 0.5)))
  assert.equal(ledger.status(opts).spentUsd, 8.5)

  const parts = ledger.breakdown(15)
  assert.deepEqual(parts.map((p) => [p.kind, p.model, p.requests, p.costUsd]), [
    ['verify', 'claude-opus-5-5', 1, 5],
    ['chat', 'claude-sonnet-5-5', 3, 3.5],
  ])
  assert.equal(parts[1]!.cacheRead, 4000)

  // Riletto da disco: stessi totali, e i campi nuovi ci sono.
  const again = new UsageLedger(dir, () => TZ, () => now)
  await again.load()
  assert.equal(again.status(opts).spentUsd, 8.5)
  const rec = usageRecord('devices', 'x', { ...u('claude-opus-5-5', 0.3), searches: 2, cacheWrite1h: 500 }, { step: 'studio', effort: 'low' })
  assert.deepEqual([rec.step, rec.effort, rec.searches, rec.cacheWrite1h], ['studio', 'low', 2, 500])
})

test('capacità per modello: niente fallback lato server su Haiku, memoria separata', () => {
  assert.equal(supportsServerFallback('claude-haiku-5-5'), false)
  assert.equal(supportsServerFallback('claude-sonnet-5-5'), true)
  assert.equal(supportsServerFallback('claude-opus-5-5'), true)
  const mem = new FeatureMemory()
  assert.equal(mem.for('claude-haiku-5-5').fallbacks, false)
  mem.for('claude-opus-5-5').fallbacks = false // un 400 su Opus…
  assert.equal(mem.for('claude-sonnet-5-5').fallbacks, true) // …non spegne Sonnet
  assert.equal(mem.for('claude-opus-5-5').fallbacks, false)

  const req = { model: 'claude-haiku-5-5', effort: 'medium' as const, system: [{ type: 'text' as const, text: 'Istruzioni' }], user: 'ciao', schema: { type: 'object' }, maxTokens: 1000 }
  const haiku = buildStructuredParams(req, mem.for('claude-haiku-5-5').fallbacks) as Record<string, any>
  assert.equal(haiku.fallbacks, undefined)
  assert.equal(haiku.betas, undefined)
  assert.equal(haiku.system[0].cache_control, undefined)
  // Lotti di Verifica: breakpoint di cache sull'ultimo blocco del sistema.
  const cached = buildStructuredParams({ ...req, model: 'claude-opus-5-5', cacheSystem: true }, true) as Record<string, any>
  assert.deepEqual(cached.system[0].cache_control, { type: 'ephemeral' })
  assert.equal(cached.fallbacks, 'default')
  assert.equal(cached.cache_control, undefined, 'niente cache automatica: il dossier cambia a ogni lotto')
})
