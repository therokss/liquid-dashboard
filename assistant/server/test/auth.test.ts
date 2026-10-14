import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkAccess, checkAddress, isIngressAddress, normalizeAddress } from '../src/auth.ts'

const admin = async (id: string) => (id === 'admin-1' ? true : id === 'user-1' ? false : null)
const headers = (id?: string) => (id ? { 'x-remote-user-id': id, 'x-remote-user-name': 'mario', 'x-remote-user-display-name': 'Mario' } : {})

test('normalizza gli indirizzi IPv4 mappati in IPv6', () => {
  assert.equal(normalizeAddress('::ffff:172.30.32.2'), '172.30.32.2')
  assert.equal(isIngressAddress('::ffff:172.30.32.2'), true)
  assert.equal(isIngressAddress('172.30.32.1'), false)
  assert.equal(isIngressAddress(undefined), false)
})

test('add-on: rifiuta richieste che non arrivano dal proxy ingress, anche con header validi', async () => {
  const r = await checkAccess({ remoteAddress: '172.30.33.5', headers: headers('admin-1') }, { mode: 'addon', isAdmin: admin })
  assert.deepEqual(r, { ok: false, status: 403, reason: 'non_da_ingress' })
})

test('add-on: senza utente ingress risponde 401', async () => {
  const r = await checkAccess({ remoteAddress: '172.30.32.2', headers: headers() }, { mode: 'addon', isAdmin: admin })
  assert.equal(r.ok, false)
  assert.equal(!r.ok && r.status, 401)
})

test('add-on: utente non amministratore respinto con 403', async () => {
  const r = await checkAccess({ remoteAddress: '172.30.32.2', headers: headers('user-1') }, { mode: 'addon', isAdmin: admin })
  assert.deepEqual(r, { ok: false, status: 403, reason: 'non_admin' })
})

test('add-on: se HA non sa dire chi è admin risponde 503, non apre le porte', async () => {
  const r = await checkAccess({ remoteAddress: '172.30.32.2', headers: headers('sconosciuto') }, { mode: 'addon', isAdmin: admin })
  assert.deepEqual(r, { ok: false, status: 503, reason: 'verifica_admin_non_disponibile' })
})

test('add-on: amministratore ammesso con i dati degli header', async () => {
  const r = await checkAccess({ remoteAddress: '::ffff:172.30.32.2', headers: headers('admin-1') }, { mode: 'addon', isAdmin: admin })
  assert.deepEqual(r, { ok: true, user: { id: 'admin-1', name: 'mario', displayName: 'Mario', admin: true } })
})

test('sviluppo: solo localhost, gli header ingress vengono ignorati', async () => {
  const local = await checkAccess({ remoteAddress: '127.0.0.1', headers: {} }, { mode: 'dev', isAdmin: admin })
  assert.equal(local.ok, true)
  const lan = await checkAccess({ remoteAddress: '192.168.1.20', headers: headers('admin-1') }, { mode: 'dev', isAdmin: admin })
  assert.deepEqual(lan, { ok: false, status: 403, reason: 'solo_localhost' })
})

test('file statici: stesso controllo di indirizzo', () => {
  assert.equal(checkAddress('172.30.32.2', 'addon'), true)
  assert.equal(checkAddress('192.168.1.20', 'addon'), false)
  assert.equal(checkAddress('::1', 'dev'), true)
})
