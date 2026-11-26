import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { branchMessages } from './groq-prompt.ts'
import { GROQ_MODEL, branchSchema, validateBranch, validateExpansion, validateContext } from '../shared/groq.ts'

class ApiError extends Error { constructor(message: string, public status = 400) { super(message) } }
function key(secret = process.env.GROQ_ENCRYPTION_KEY) {
  if (!secret || !/^[A-Za-z0-9+/]{43}=$/.test(secret.trim())) throw new ApiError('Falta configurar GROQ_ENCRYPTION_KEY en el servidor.', 503)
  return Buffer.from(secret.trim(), 'base64')
}
export function sealCredential(apiKey: string, secret?: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv)
  cipher.setAAD(Buffer.from('arbol.groq.v1'))
  const encrypted = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()])
  return `v1.${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url')}`
}
export function openCredential(token: string, secret?: string) {
  const encryptionKey = key(secret)
  try {
    if (!/^v1\.[\w-]{40,1500}$/.test(token)) throw new Error()
    const data = Buffer.from(token.slice(3), 'base64url')
    const cipher = createDecipheriv('aes-256-gcm', encryptionKey, data.subarray(0, 12))
    cipher.setAAD(Buffer.from('arbol.groq.v1'))
    cipher.setAuthTag(data.subarray(12, 28))
    return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8')
  } catch { throw new ApiError('Configurá nuevamente la clave de Groq.', 401) }
}
async function jsonBody(request: Request) {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new ApiError('Se requiere JSON.', 415)
  const reader = request.body?.getReader()
  if (!reader) throw new ApiError('Pedido vacío.')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 256000) { await reader.cancel(); throw new ApiError('El contexto es demasiado grande.', 413) }
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
  } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError('JSON inválido.') }
}
async function groq(path: string, apiKey: string, signal: AbortSignal, body?: unknown) {
  const response = await fetch(`https://api.groq.com/openai/v1/${path}`, {
    method: body ? 'POST' : 'GET', signal,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!response.ok) {
    if ([401, 403].includes(response.status)) throw new ApiError('Groq rechazó la clave o el acceso al modelo.', 401)
    if (response.status === 429) throw new ApiError('Groq alcanzó su límite. Intentá nuevamente en unos segundos.', 429)
    throw new ApiError('Groq no pudo completar el pedido.', 502)
  }
  return response.json()
}
export async function handleGroq(request: Request, action: 'configure' | 'branch') {
  const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' }
  const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers })
  try {
    if (request.method !== 'POST') throw new ApiError('Método no permitido.', 405)
    const origin = request.headers.get('origin')
    if (origin && origin !== new URL(request.url).origin) throw new ApiError('Origen no permitido.', 403)
    key()
    const body = await jsonBody(request)
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45000)])
    if (action === 'configure') {
      if (typeof body.apiKey !== 'string' || !/^gsk_[A-Za-z0-9_-]{10,500}$/.test(body.apiKey.trim())) throw new ApiError('Ingresá una clave válida de Groq.')
      const apiKey = body.apiKey.trim()
      const models = await groq('models', apiKey, signal)
      if (!Array.isArray(models.data) || !models.data.some((model: { id: string }) => model.id === GROQ_MODEL)) throw new ApiError('La clave no tiene acceso a GPT-OSS 20B.', 403)
      return reply({ credential: sealCredential(apiKey), model: GROQ_MODEL })
    }
    if (typeof body.credential !== 'string' || typeof body.instruction !== 'string' || !body.instruction.trim() || body.instruction.length > 16000) throw new ApiError('Escribí una instrucción válida.')
    const apiKey = openCredential(body.credential)
    let context
    try { context = validateContext(body.context) } catch { throw new ApiError('El contexto del pedido no es válido.') }
    const response = await groq('chat/completions', apiKey, signal, {
      model: GROQ_MODEL, reasoning_effort: 'low', include_reasoning: false, max_completion_tokens: 4096, stream: false,
      messages: branchMessages(context, body.instruction),
      response_format: { type: 'json_schema', json_schema: { name: 'branch', strict: true, schema: branchSchema } },
    })
    const choice = response.choices?.[0]
    if (choice?.finish_reason !== 'stop' || typeof choice.message?.content !== 'string' || choice.message.refusal) throw new ApiError('Groq devolvió una respuesta incompleta. Reintentá con un pedido más breve.', 502)
    let result
    try { result = validateBranch(JSON.parse(choice.message.content)) }
    catch { throw new ApiError('Groq no devolvió una rama válida. Intentá nuevamente.', 502) }
    try { validateExpansion(result, context.target) }
    catch { throw new ApiError('Groq devolvió títulos repetidos en lugar de ampliar el nodo. Intentá nuevamente con un pedido más específico.', 502) }
    return reply(result)
  } catch (error) {
    if (error instanceof ApiError) return reply({ error: error.message }, error.status)
    if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) return reply({ error: 'El pedido se interrumpió o tardó demasiado.' }, 504)
    // Never return upstream bodies, keys, request content, or stack traces.
    return reply({ error: 'No se pudo completar el pedido. Revisá la conexión o el contexto.' }, 502)
  }
}
