import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_OPTIONS, parseOptions, publicOptions } from '../src/options.ts'
import { addSecret, redact } from '../src/log.ts'

test('default: Sonnet 5.5 in chat, Opus 5.5 per le analisi', () => {
  const o = parseOptions({})
  assert.deepEqual(o, DEFAULT_OPTIONS)
  assert.equal(o.chatModel, 'claude-sonnet-5-5')
  assert.equal(o.analysisModel, 'claude-opus-5-5')
})

test('valori non validi tornano ai default', () => {
  const o = parseOptions({ chat_effort: 'altissimo', monthly_budget_warn_usd: -3, chat_model: '  ' })
  assert.equal(o.chatEffort, 'medium')
  assert.equal(o.monthlyBudgetWarnUsd, 25)
  assert.equal(o.chatModel, 'claude-sonnet-5-5')
})

test('publicOptions non espone mai la chiave', () => {
  const o = parseOptions({ anthropic_api_key: 'sk-ant-abcdefghijkl' })
  const pub = publicOptions(o)
  assert.equal(JSON.stringify(pub).includes('sk-ant'), false)
  assert.equal(pub.anthropicConfigured, true)
})

test('i segreti registrati vengono oscurati nei log', () => {
  addSecret('sk-ant-molto-segreta')
  assert.equal(redact('chiave=sk-ant-molto-segreta fine'), 'chiave=[nascosto] fine')
})
