import type { NodeObj } from 'mind-elixir'
import type { BranchContext, ContextNode, BranchResult } from '../shared/groq'
import { validateBranch } from '../shared/groq'
import { walkHighlight, type WalkStep } from './walk'

export function nodePath(root: NodeObj, id: string): NodeObj[] {
  const path: NodeObj[] = []
  function find(node: NodeObj): boolean {
    path.push(node)
    if (node.id === id || node.children?.some(find)) return true
    path.pop(); return false
  }
  find(root)
  return path
}
export function branchContext(root: NodeObj, step: WalkStep, targetId: string): BranchContext {
  const state = walkHighlight(root, step, false)
  const lit = new Set([...state.local, ...state.trail])
  if (!lit.has(targetId)) throw new Error('Elegí un nodo iluminado para ampliar.')
  const nodes = new Map<string, ContextNode>()
  function visit(node: NodeObj, parentId: string | null) {
    if (lit.has(node.id)) nodes.set(node.id, { id: node.id, topic: node.topic, parentId })
    node.children?.forEach(child => visit(child, node.id))
  }
  visit(root, null)
  return { root: nodes.get(root.id)!, path: nodePath(root, targetId).map(node => nodes.get(node.id)!),
    target: nodes.get(targetId)!, illuminated: [...nodes.values()] }
}
export function appendBranch(root: NodeObj, targetId: string, value: BranchResult) {
  const result = validateBranch(value)
  const next = structuredClone(root)
  const path = nodePath(next, targetId)
  const target = path.at(-1)
  if (!target) throw new Error('El nodo de destino ya no existe.')
  const make = (node: BranchResult['children'][number]): NodeObj => ({ id: crypto.randomUUID(), topic: node.topic, expanded: true, children: node.children.map(make) })
  const children = result.children.map(make)
  let first = children[0]
  while (first.children?.length) first = first.children[0]
  target.children = [...(target.children ?? []), ...children]
  target.expanded = true
  let count = 0
  function check(node: NodeObj, depth: number) {
    if (++count > 10000 || depth > 100) throw new Error('La rama excede el tamaño máximo del mapa.')
    node.children?.forEach(child => check(child, depth + 1))
  }
  check(next, 0)
  return { root: next, firstLeafId: first.id }
}
