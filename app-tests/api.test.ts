import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import handler, { processAi } from '../api/ai'

const request = { action: 'generate', text: 'Continuidad', context: '' }
const proposal = { summary: 'Un concepto', nodes: [{ id: 'a', parentId: '', topic: 'Continuidad', note: 'Definición', relation: '' }] }
const response = (status: number, data: unknown) => (async () => new Response(JSON.stringify(data), { status })) as typeof fetch

test('una propuesta válida se devuelve sin exponer la clave', async () => {
  let called = false
  const fetcher: typeof fetch = async (url, options) => {
    called = true
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions')
    assert.equal((options!.headers as Record<string, string>).Authorization, 'Bearer clave-privada')
    const body = JSON.parse(options!.body as string)
    assert.equal(body.model, 'openai/gpt-oss-20b')
    assert.equal(body.response_format.json_schema.strict, true)
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(proposal) } }] }))
  }
  const result = await processAi(request, 'clave-privada', undefined, fetcher)
  assert.equal(called, true)
  assert.equal(result.status, 200)
  assert.deepEqual(result.body, proposal)
  assert.ok(!JSON.stringify(result.body).includes('clave-privada'))
})
test('sin clave o con entrada inválida no se llama al proveedor', async () => {
  const unused = (() => { throw new Error('No debe llamarse') }) as typeof fetch
  assert.equal((await processAi(request, undefined, undefined, unused)).status, 503)
  assert.equal((await processAi({}, 'clave', undefined, unused)).status, 400)
})
test('traduce límites, credenciales y errores de Groq', async () => {
  for (const [upstream, expected] of [[429, 429], [401, 502], [403, 502], [500, 502]]) {
    const result = await processAi(request, 'clave', undefined, response(upstream, { error: 'interno' }))
    assert.equal(result.status, expected)
    assert.ok(!JSON.stringify(result.body).includes('interno'))
  }
})
test('rechaza respuestas vacías, JSON roto y propuestas inválidas', async () => {
  for (const content of ['not-json', '{}', JSON.stringify({ ...proposal, nodes: [{ ...proposal.nodes[0], parentId: 'ausente' }] })]) {
    assert.equal((await processAi(request, 'clave', undefined, response(200, { choices: [{ message: { content } }] }))).status, 502)
  }
})
test('gestiona timeout y caída de red', async () => {
  for (const [name, status] of [['TimeoutError', 504], ['AbortError', 504], ['TypeError', 502]]) {
    const broken = (async () => { throw Object.assign(new Error('error'), { name }) }) as typeof fetch
    assert.equal((await processAi(request, 'clave', undefined, broken)).status, status)
  }
})
test('el handler HTTP valida método, JSON y ausencia de configuración', async () => {
  const server = createServer((req, res) => { void handler(req, res) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    assert.equal((await fetch(url)).status, 405)
    assert.equal((await fetch(url, { method: 'POST', body: '{roto' })).status, 400)
    const invalid = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    assert.equal(invalid.status, 400)
    assert.equal(invalid.headers.get('cache-control'), 'no-store')
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
