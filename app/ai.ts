import type { MindElixirData, NodeObj } from '../src/types/index'

export const actions = ['generate', 'expand', 'explain', 'examples', 'questions'] as const
export type Action = typeof actions[number]
export interface AiRequest { action: Action; text: string; context: string }
export interface ProposalNode { id: string; parentId: string; topic: string; note: string; relation: string }
export interface Proposal { summary: string; nodes: ProposalNode[] }

export const proposalSchema = {
  type: 'object', additionalProperties: false, required: ['summary', 'nodes'],
  properties: {
    summary: { type: 'string' },
    nodes: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['id', 'parentId', 'topic', 'note', 'relation'],
      properties: { id: { type: 'string' }, parentId: { type: 'string' }, topic: { type: 'string' }, note: { type: 'string' }, relation: { type: 'string' } },
    } },
  },
}

export function parseRequest(value: unknown): AiRequest {
  if (!value || typeof value !== 'object') throw new Error('Solicitud inválida.')
  const v = value as Record<string, unknown>
  if (!actions.includes(v.action as Action) || typeof v.text !== 'string' || typeof v.context !== 'string' || !v.text.trim()) {
    throw new Error('Elegí una acción y escribí un tema o una pregunta.')
  }
  return { action: v.action as Action, text: v.text, context: v.context }
}

export function parseProposal(value: unknown): Proposal {
  if (!value || typeof value !== 'object') throw new Error('Propuesta inválida.')
  const p = value as Proposal
  if (typeof p.summary !== 'string' || !Array.isArray(p.nodes) || !p.nodes.length) throw new Error('La IA no devolvió conceptos.')
  const nodes = new Map<string, ProposalNode>()
  for (const n of p.nodes) {
    if (!n || !['id', 'parentId', 'topic', 'note', 'relation'].every(k => typeof n[k as keyof ProposalNode] === 'string') ||
        !n.id || !n.topic.trim() || nodes.has(n.id)) throw new Error('La IA devolvió conceptos inválidos.')
    nodes.set(n.id, n)
  }
  for (const node of p.nodes) {
    const seen = new Set([node.id])
    let parent = node.parentId
    while (parent) {
      if (!nodes.has(parent) || seen.has(parent)) throw new Error('La IA devolvió una estructura circular o incompleta.')
      seen.add(parent)
      parent = nodes.get(parent)!.parentId
    }
  }
  // Return only the documented text fields; never accept model-generated HTML.
  return { summary: p.summary, nodes: p.nodes.map(n => ({ id: n.id, parentId: n.parentId, topic: n.topic, note: n.note, relation: n.relation })) }
}

export function applyProposal(data: MindElixirData, proposal: Proposal, action: Action, targetId: string, uuid: () => string = () => crypto.randomUUID()): MindElixirData {
  const p = parseProposal(proposal)
  const result = structuredClone(data)
  const nodes = new Map<string, NodeObj>()
  function visit(n: NodeObj) { nodes.set(n.id, n); n.children?.forEach(visit) }
  visit(result.nodeData)
  let target = nodes.get(targetId)
  if (!target && action !== 'generate') throw new Error('El concepto seleccionado ya no existe.')
  const created = new Map(p.nodes.map(n => [n.id, { id: uuid(), topic: n.topic, note: n.note, children: [] } as NodeObj]))
  const roots = p.nodes.filter(n => !n.parentId)
  if (action === 'generate') {
    if (roots.length !== 1) throw new Error('Un mapa nuevo debe tener un único concepto central.')
    result.nodeData = created.get(roots[0].id)!
    result.arrows = []
    result.summaries = []
    target = result.nodeData
  }
  for (const n of p.nodes) {
    const child = created.get(n.id)!
    if (action === 'generate' && n.id === roots[0].id) continue
    const parent = n.parentId ? created.get(n.parentId)! : target!
    parent.children ??= []
    parent.children.push(child)
    parent.expanded = true
    if (n.relation.trim()) {
      result.arrows ??= []
      result.arrows.push({ id: uuid(), from: parent.id, to: child.id, label: n.relation })
    }
  }
  return result
}
