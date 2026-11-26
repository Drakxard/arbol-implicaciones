export const GROQ_MODEL = 'openai/gpt-oss-20b'
export const AI_STORAGE_KEY = 'arbol.groq.v1'
export interface ContextNode { id: string; topic: string; parentId: string | null }
export interface BranchContext { root: ContextNode; path: ContextNode[]; target: ContextNode; illuminated: ContextNode[] }
export interface GeneratedNode { topic: string; children: GeneratedNode[] }
export interface BranchResult { children: GeneratedNode[] }

export function validateBranch(value: unknown): BranchResult {
  let count = 0
  function visit(raw: unknown, depth: number): GeneratedNode {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('La respuesta no contiene una jerarquía válida.')
    const node = raw as Record<string, unknown>
    if (++count > 32 || depth > 5 || typeof node.topic !== 'string' || !node.topic.trim() || node.topic.length > 16000 ||
      !Array.isArray(node.children) || Object.keys(node).some(key => !['topic', 'children'].includes(key))) {
      throw new Error('La respuesta excede los límites de la rama o está incompleta.')
    }
    return { topic: node.topic, children: node.children.map(child => visit(child, depth + 1)) }
  }
  const raw = value as Record<string, unknown> | null
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.children) || !raw.children.length || Object.keys(raw).some(key => key !== 'children')) {
    throw new Error('La respuesta no contiene hijos para insertar.')
  }
  return { children: raw.children.map(child => visit(child, 1)) }
}

export function validateContext(value: unknown): BranchContext {
  const fail = (): never => { throw new Error('El contexto del pedido no es válido.') }
  function node(value: unknown): ContextNode {
    if (!value || typeof value !== 'object') return fail()
    const raw = value as Record<string, unknown>
    if (typeof raw.id !== 'string' || !/^[\w-]+$/.test(raw.id) || typeof raw.topic !== 'string' || raw.topic.length > 100000 ||
      !(raw.parentId === null || typeof raw.parentId === 'string')) return fail()
    return { id: raw.id, topic: raw.topic, parentId: raw.parentId as string | null }
  }
  if (!value || typeof value !== 'object') return fail()
  const raw = value as Record<string, unknown>
  if (!Array.isArray(raw.path) || !raw.path.length || raw.path.length > 101 || !Array.isArray(raw.illuminated) || raw.illuminated.length > 10000) return fail()
  const context = { root: node(raw.root), target: node(raw.target), path: raw.path.map(node), illuminated: raw.illuminated.map(node) }
  if (context.root.parentId !== null || context.path[0].id !== context.root.id || context.path.at(-1)!.id !== context.target.id ||
    context.path.some((item, index) => index > 0 && item.parentId !== context.path[index - 1].id) ||
    new Set(context.path.map(item => item.id)).size !== context.path.length ||
    new Set(context.illuminated.map(item => item.id)).size !== context.illuminated.length) return fail()
  const known = new Map(context.illuminated.map(item => [item.id, item]))
  for (const item of [context.root, context.target, ...context.path]) {
    const canonical = known.get(item.id)
    if (!canonical || canonical.topic !== item.topic || canonical.parentId !== item.parentId) return fail()
  }
  for (const item of context.illuminated) {
    if (item.id !== context.root.id && (!item.parentId || !known.has(item.parentId))) return fail()
  }
  return context
}

export function validateExpansion(value: unknown, target: Pick<ContextNode, 'topic'>): BranchResult {
  const result = validateBranch(value)
  const normalize = (topic: string) => topic.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('es')
  function visit(nodes: GeneratedNode[], parent: string) {
    for (const node of nodes) {
      if (normalize(node.topic) === normalize(parent)) throw new Error('La respuesta repite un nodo como su propio hijo.')
      visit(node.children, node.topic)
    }
  }
  visit(result.children, target.topic)
  return result
}

export const branchSchema = {
  type: 'object', properties: { children: { type: 'array', items: { $ref: '#/$defs/node' } } },
  required: ['children'], additionalProperties: false,
  $defs: { node: { type: 'object', properties: { topic: { type: 'string' }, children: { type: 'array', items: { $ref: '#/$defs/node' } } }, required: ['topic', 'children'], additionalProperties: false } },
}
