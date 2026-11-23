import type { NodeObj } from 'mind-elixir'

export interface WalkStep {
  parent: NodeObj
  children: NodeObj[]
  activeId: string
}

/** Reveal leaf siblings locally; entering another subtree replaces the previous group. */
export function walkSteps(root: NodeObj): WalkStep[] {
  const steps: WalkStep[] = []
  function visit(node: NodeObj) {
    let siblings: NodeObj[] = []
    for (const child of node.children ?? []) {
      if (child.children?.length) {
        visit(child)
        // A completed local subtree must not return when the next sibling is revealed.
        siblings = []
      } else {
        siblings = [...siblings, child]
        steps.push({ parent: node, children: siblings, activeId: child.id })
      }
    }
  }
  visit(root)
  return steps.length ? steps : [{ parent: root, children: [], activeId: root.id }]
}

export function walkTree(step: WalkStep, focus: boolean): NodeObj {
  const copy = (node: NodeObj): NodeObj => {
    const { parent: _parent, children: _children, ...rest } = node
    return { ...structuredClone(rest), expanded: true }
  }
  const tree = copy(step.parent)
  tree.children = step.children.filter(node => !focus || node.id === step.activeId).map(copy)
  return tree
}

export function walkHighlight(root: NodeObj, step: WalkStep, focus: boolean) {
  const local = new Set([step.parent.id, ...step.children.filter(child => !focus || child.id === step.activeId).map(child => child.id)])
  const trail = new Set<string>()
  function find(node: NodeObj): boolean {
    if (node.id === step.parent.id) return true
    if (node.children?.some(find)) { trail.add(node.id); return true }
    return false
  }
  find(root)
  const edges = new Set([...local, ...trail])
  edges.delete(root.id)
  return { local, trail, edges }
}

/** Crop only the camera's ancestor context; the full tree and its lighting stay intact. */
export function walkFrame(root: NodeObj, step: WalkStep, depth: number, focus: boolean) {
  const path: NodeObj[] = []
  function find(node: NodeObj): boolean {
    path.push(node)
    if (node.id === step.parent.id || node.children?.some(find)) return true
    path.pop()
    return false
  }
  if (!find(root)) path.push(root)
  const maxDepth = path.length - 1
  const level = Math.max(0, Math.min(maxDepth, depth))
  const ids = new Set([...path.slice(level).map(node => node.id),
    ...step.children.filter(child => !focus || child.id === step.activeId).map(child => child.id)])
  return { depth: level, maxDepth, rootId: path[level].id, ids }
}
