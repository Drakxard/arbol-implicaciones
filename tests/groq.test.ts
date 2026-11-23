import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { sealCredential, openCredential, handleGroq } from '../server/groq'
import { validateBranch, validateContext, GROQ_MODEL, type GeneratedNode } from '../shared/groq'
import { appendBranch, branchContext } from '../app/ai-context'
import { walkSteps } from '../app/walk'
import { listEdit, listNewline } from '../app/composer'

const apiKey = 'gsk_a_test_key_1234567890'
const root = { id: 'root', topic: '$P(A)$', children: [
  { id: 'a', topic: '**A**', children: [{ id: 'a1', topic: String.raw`$\frac{1}{2}$` }, { id: 'a2', topic: 'Otro' }] },
  { id: 'b', topic: 'No enviar', note: 'Privado', image: { url: 'https://private.example/image.png', width: 1, height: 1 } },
] }
const context = () => branchContext(root, walkSteps(root)[0], 'a1')
const result = { children: [{ topic: 'Ejemplo', children: [{ topic: '$x=2$', children: [] }] }] }
const request = (body: unknown, origin = 'https://app.test') => new Request('https://app.test/api/groq/branch', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) })

test('cifrado autenticado usa IV aleatorio y rechaza datos alterados y otra semilla', () => {
  const secret = randomBytes(32).toString('base64')
  const first = sealCredential(apiKey, secret)
  assert.notEqual(first, sealCredential(apiKey, secret))
  assert.ok(!first.includes(apiKey))
  assert.equal(openCredential(first, secret), apiKey)
  const bytes = Buffer.from(first.slice(3), 'base64url'); bytes[15] ^= 1
  assert.throws(() => openCredential(`v1.${bytes.toString('base64url')}`, secret), /nuevamente/)
  assert.throws(() => openCredential(first, randomBytes(32).toString('base64')), /nuevamente/)
  assert.throws(() => sealCredential(apiKey, 'short'), /GROQ_ENCRYPTION_KEY/)
})

test('contexto incluye solo texto iluminado, conserva KaTeX y permite elegir antepasados', () => {
  const data = context()
  assert.deepEqual(data.path.map(node => node.id), ['root', 'a', 'a1'])
  assert.deepEqual(data.illuminated.map(node => node.id), ['root', 'a', 'a1'])
  assert.equal(data.target.topic, String.raw`$\frac{1}{2}$`)
  assert.ok(!JSON.stringify(data).includes('Privado'))
  assert.ok(!JSON.stringify(data).includes('https://'))
  assert.equal(branchContext(root, walkSteps(root)[0], 'a').target.id, 'a')
  assert.throws(() => branchContext(root, walkSteps(root)[0], 'b'), /iluminado/)
  assert.deepEqual(validateContext(data), data)
  assert.throws(() => validateContext({ ...data, path: [...data.path, data.root] }))
})

test('inserción agrega hijos con ids nuevos, conserva el original y localiza la primera hoja', () => {
  const before = JSON.stringify(root)
  const next = appendBranch(root, 'a', result)
  assert.equal(JSON.stringify(root), before)
  assert.equal(next.root.children![0].children!.length, 3)
  const added = next.root.children![0].children![2]
  assert.equal(added.topic, 'Ejemplo')
  assert.equal(added.children![0].id, next.firstLeafId)
  assert.notEqual(appendBranch(root, 'a', result).firstLeafId, next.firstLeafId)
  assert.throws(() => appendBranch(root, 'missing', result), /ya no existe/)
})

test('rechaza jerarquías incompletas, propiedades de código y límites de generación', () => {
  for (const data of [{}, { children: [] }, { children: [{ topic: 'x' }] },
    { children: [{ topic: 'x', children: [], dangerouslySetInnerHTML: 'evil' }] },
    { children: Array.from({ length: 33 }, () => ({ topic: 'x', children: [] })) }]) assert.throws(() => validateBranch(data))
  let node: GeneratedNode = { topic: 'x', children: [] }
  for (let depth = 0; depth < 5; depth++) node = { topic: 'x', children: [node] }
  assert.throws(() => validateBranch({ children: [node] }))
})

test('listas convierten selección, alternan numeración y continúan o terminan con Enter', () => {
  assert.equal(listEdit('uno\ndos', 0, 7, false).text, '- uno\n- dos')
  assert.equal(listEdit('- uno\n- dos', 0, 11, true).text, '1. uno\n2. dos')
  assert.equal(listEdit('1. uno\n2. dos', 0, 13, true).text, 'uno\ndos')
  assert.deepEqual(listNewline('2. dos', 6, 6), { from: 6, to: 6, text: '\n3. ' })
  assert.deepEqual(listNewline('- ', 2, 2), { from: 0, to: 2, text: '' })
  assert.deepEqual(listEdit('\nsegunda línea', 0, 0, false), { from: 0, to: 0, text: '- ' })
})

test('servidor configura y genera con modelo y esquema fijos sin devolver claves', async () => {
  const originalFetch = globalThis.fetch
  const originalSecret = process.env.GROQ_ENCRYPTION_KEY
  process.env.GROQ_ENCRYPTION_KEY = randomBytes(32).toString('base64')
  const calls: { url: string; body: Record<string, unknown> | null }[] = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), body: options?.body ? JSON.parse(String(options.body)) : null })
    assert.equal((options?.headers as Record<string, string>).Authorization, `Bearer ${apiKey}`)
    return Response.json(String(url).endsWith('models') ? { data: [{ id: GROQ_MODEL }] } : { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] })
  }
  try {
    const configured = await handleGroq(request({ apiKey }), 'configure')
    assert.equal(configured.status, 200)
    const config = await configured.json()
    assert.ok(!JSON.stringify(config).includes(apiKey))
    const response = await handleGroq(request({ credential: config.credential, context: context(), instruction: 'Ejemplificar con KaTeX' }), 'branch')
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await response.json(), result)
    assert.equal(calls[1].body!.model, GROQ_MODEL)
    assert.equal(calls[1].body!.reasoning_effort, 'low')
    assert.equal(calls[1].body!.stream, false)
    assert.equal(calls[1].body!.max_completion_tokens, 4096)
    assert.equal((await handleGroq(request({}, 'https://evil.test'), 'branch')).status, 403)
    assert.equal((await handleGroq(request({ credential: 'bad', instruction: 'test' }), 'branch')).status, 401)
    assert.equal(calls.length, 2)
    assert.equal((await handleGroq(request({ credential: config.credential, context: {}, instruction: 'test' }), 'branch')).status, 400)
    globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: 'length', message: { content: JSON.stringify(result) } }] })
    assert.equal((await handleGroq(request({ credential: config.credential, context: context(), instruction: 'test' }), 'branch')).status, 502)
    globalThis.fetch = async () => new Response(apiKey, { status: 429 })
    const limited = await handleGroq(request({ credential: config.credential, context: context(), instruction: 'test' }), 'branch')
    assert.equal(limited.status, 429)
    assert.ok(!(await limited.text()).includes(apiKey))
  } finally {
    globalThis.fetch = originalFetch
    if (originalSecret === undefined) delete process.env.GROQ_ENCRYPTION_KEY; else process.env.GROQ_ENCRYPTION_KEY = originalSecret
  }
})
