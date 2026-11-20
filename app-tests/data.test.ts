import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exampleMap, loadMap, saveMap, validateMap } from '../app/data'
import { applyProposal, parseProposal, type Proposal } from '../app/ai'

test('el guardado y JSON conservan notas, conceptos y relaciones', () => {
  const data = exampleMap()
  data.nodeData.children![0].note = 'Una pregunta y su respuesta'
  data.arrows = [{ id: 'a1', from: 'conceptos', to: 'practica', label: 'requiere' }]
  data.summaries = [{ id: 's1', parent: 'conceptos', start: 0, end: 0, label: 'Repasar' }]
  const memory = new Map<string, string>()
  const storage = { setItem: (k: string, v: string) => { memory.set(k, v) }, getItem: (k: string) => memory.get(k) ?? null }
  assert.equal(loadMap(storage), null)
  saveMap(storage, data)
  assert.deepEqual(loadMap(storage), data)
  assert.deepEqual(validateMap(JSON.parse(JSON.stringify(data))), data)
})

test('rechaza JSON dañado, IDs duplicados y relaciones huérfanas', () => {
  for (const value of [null, {}, { nodeData: { id: 'a', topic: 'Tema', children: [{ id: 'a', topic: 'Duplicado' }] } },
    { ...exampleMap(), arrows: [{ id: 'a', from: 'root', to: 'ausente', label: 'implica' }] }]) assert.throws(() => validateMap(value))
  assert.throws(() => loadMap({ getItem: () => '{roto' }))
})

test('rechaza HTML y enlaces ejecutables al importar', () => {
  assert.throws(() => validateMap({ nodeData: { id: 'r', topic: 'Tema', dangerouslySetInnerHTML: '<script>alert(1)</script>' } }))
  assert.throws(() => validateMap({ nodeData: { id: 'r', topic: 'Tema', hyperLink: 'javascript:alert(1)' } }))
})

const proposal: Proposal = { summary: 'Continuidad', nodes: [
  { id: 'a', parentId: '', topic: 'Continuidad', note: 'Revisar definición', relation: '' },
  { id: 'b', parentId: 'a', topic: 'Límite', note: 'Debe existir', relation: 'requiere' },
] }
test('genera un mapa y amplía un concepto sin modificar el original', () => {
  const data = exampleMap()
  let nextId = 0
  const generated = applyProposal(data, proposal, 'generate', 'root', () => `node-${nextId++}`)
  assert.equal(generated.nodeData.topic, 'Continuidad')
  assert.equal(generated.nodeData.children![0].note, 'Debe existir')
  assert.equal(generated.arrows![0].label, 'requiere')
  assert.equal(data.nodeData.topic, 'Mi próximo parcial')
  const expanded = applyProposal(data, proposal, 'expand', 'conceptos')
  assert.equal(expanded.nodeData.children![0].children![1].topic, 'Continuidad')
  assert.throws(() => applyProposal(data, proposal, 'expand', 'eliminado'))
})

test('rechaza propuestas con ciclos, padres ausentes o IDs repetidos', () => {
  assert.throws(() => parseProposal({ summary: '', nodes: [] }))
  assert.throws(() => parseProposal({ summary: '', nodes: [{ ...proposal.nodes[0], parentId: 'a' }] }))
  assert.throws(() => parseProposal({ summary: '', nodes: [{ ...proposal.nodes[0], parentId: 'ausente' }] }))
  assert.throws(() => parseProposal({ summary: '', nodes: [proposal.nodes[0], proposal.nodes[0]] }))
})
