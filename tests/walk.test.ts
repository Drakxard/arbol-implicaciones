import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { NodeObj } from 'mind-elixir'
import { walkSteps, walkTree, walkHighlight } from '../app/walk'

const node = (id: string, children?: NodeObj[]): NodeObj => ({ id, topic: id, children })
const tree = () => node('root', [node('purple', [node('p1'), node('p2')]),
  node('blue', [node('b1'), node('b2', [node('c1'), node('c2')])])])
const ids = (root: NodeObj): string[] => [root.id, ...(root.children ?? []).flatMap(ids)]

test('recorre grupos de hojas con su padre y reemplaza el subárbol local al avanzar', () => {
  const root = tree()
  const before = JSON.stringify(root)
  const steps = walkSteps(root)
  const expected = [
    ['purple', 'p1'], ['purple', 'p1', 'p2'],
    ['blue', 'b1'], ['b2', 'c1'], ['b2', 'c1', 'c2'],
  ]
  assert.deepEqual(steps.map(step => ids(walkTree(step, false))), expected)
  assert.deepEqual([...steps].reverse().map(step => ids(walkTree(step, false))), [...expected].reverse())
  assert.equal(JSON.stringify(root), before)
})

test('la mira muestra únicamente el padre y la hoja activa sin compartir datos editables', () => {
  const root = tree()
  root.children![1].children![1].expanded = false
  const step = walkSteps(root).at(-1)!
  const focused = walkTree(step, true)
  assert.deepEqual(ids(focused), ['b2', 'c2'])
  assert.equal(focused.expanded, true)
  focused.children![0].topic = 'cambio'
  assert.equal(root.children![1].children![1].children![0].topic, 'c1')
  assert.equal(root.children![1].children![1].expanded, false)
})

test('árboles de un nodo, cadenas y ramas desbalanceadas muestran todas las hojas con su padre inmediato', () => {
  for (const root of [node('solo'), node('a', [node('b', [node('c')])]),
    node('a', [node('b'), node('c', [node('d')]), node('e')])]) {
    const steps = walkSteps(root)
    assert.ok(steps.length)
    const leaves = (node: NodeObj): string[] => node.children?.length ? node.children.flatMap(leaves) : [node.id]
    assert.deepEqual(steps.map(step => step.activeId), leaves(root))
    for (const step of steps) {
      const visible = walkTree(step, false)
      assert.equal(visible.id, step.parent.id)
      assert.ok(visible.children?.every(child => !child.children?.length))
    }
  }
})

test('volver a un padre después de un subárbol intermedio no recupera sus hojas anteriores', () => {
  const root = node('root', [node('a'), node('b'), node('internal', [node('deep', [node('c'), node('d')])]), node('e'), node('f')])
  const steps = walkSteps(root)
  assert.deepEqual(steps.map(step => ids(walkTree(step, false))), [
    ['root', 'a'], ['root', 'a', 'b'], ['deep', 'c'], ['deep', 'c', 'd'], ['root', 'e'], ['root', 'e', 'f'],
  ])
  assert.ok(steps.every(step => step.children.every(child => !child.children?.length)))
})

test('ilumina el grupo local y las conexiones hasta la raíz, sin incluir otras ramas', () => {
  const root = tree()
  const steps = walkSteps(root)
  const state = walkHighlight(root, steps.at(-1)!, false)
  assert.deepEqual([...state.local], ['b2', 'c1', 'c2'])
  assert.deepEqual([...state.trail].sort(), ['blue', 'root'])
  assert.deepEqual([...state.edges].sort(), ['b2', 'blue', 'c1', 'c2'])
  const focused = walkHighlight(root, steps.at(-1)!, true)
  assert.deepEqual([...focused.local], ['b2', 'c2'])
  assert.deepEqual([...focused.edges].sort(), ['b2', 'blue', 'c2'])
  const previous = walkHighlight(root, steps[0], false)
  assert.deepEqual([...previous.edges].sort(), ['p1', 'purple'])
  assert.ok(!previous.edges.has('blue'))
  const only = node('only')
  assert.equal(walkHighlight(only, walkSteps(only)[0], false).edges.size, 0)
})
