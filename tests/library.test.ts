import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyMap, independentCopy, moveMap, validFolderName } from '../app/library'
import { newDocument, parseDocument } from '../app/document'

class MemoryDirectory {
  files = new Map<string, string>()
  failWrite = false
  async isSameEntry(other: unknown) { return this === other }
  async *values() { for (const name of this.files.keys()) yield { name, kind: 'file' } }
  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (!this.files.has(name)) {
      if (!options?.create) throw new DOMException('Missing', 'NotFoundError')
      this.files.set(name, '')
    }
    return {
      getFile: async () => ({ text: async () => this.files.get(name)! }),
      createWritable: async () => {
        if (this.failWrite) throw new DOMException('Denied', 'NotAllowedError')
        let value = ''
        return { write: async (text: string) => { value = text }, close: async () => { this.files.set(name, value) }, abort: async () => {} }
      },
    }
  }
  async removeEntry(name: string) { this.files.delete(name) }
  get handle() { return this as unknown as FileSystemDirectoryHandle }
}

test('valida carpetas sin permitir rutas, nombres reservados ni la papelera', () => {
  for (const name of ['Curso 2026', 'Álgebra', 'Unidad 1']) assert.equal(validFolderName(name), true)
  for (const name of ['', '.', '..', '../Otra', 'A/B', 'A\\B', '.papelera', '.PAPELERA', 'CON', 'nul.txt', 'A.', 'A ', 'A:']) assert.equal(validFolderName(name), false, name)
})

test('las copias renuevan todos los identificadores y conservan relaciones, resúmenes y contenido', () => {
  const source = newDocument()
  source.nodeData.children = [{ id: 'child', topic: 'Hijo', note: 'Nota', style: { color: '#123abc' } }]
  source.arrows = [{ id: 'arrow', from: source.nodeData.id, to: 'child', label: 'Relación' }]
  source.summaries = [{ id: 'summary', parent: source.nodeData.id, start: 0, end: 0, label: 'Resumen' }]
  const copy = independentCopy(source)
  assert.notEqual(copy.nodeData.id, source.nodeData.id)
  assert.notEqual(copy.nodeData.children![0].id, 'child')
  assert.notEqual(copy.arrows![0].id, 'arrow')
  assert.equal(copy.arrows![0].from, copy.nodeData.id)
  assert.equal(copy.arrows![0].to, copy.nodeData.children![0].id)
  assert.equal(copy.summaries![0].parent, copy.nodeData.id)
  assert.notEqual(copy.summaries![0].id, 'summary')
  assert.equal(copy.nodeData.children![0].note, 'Nota')
  assert.deepEqual(parseDocument(JSON.stringify(copy)), copy)
  assert.equal(source.nodeData.children[0].id, 'child')
})

test('mover escribe antes de eliminar y rechaza destinos ocupados o iguales', async () => {
  const source = new MemoryDirectory(), destination = new MemoryDirectory()
  const text = JSON.stringify(newDocument())
  source.files.set('Mapa.json', text)
  destination.files.set('Mapa.json', 'contenido ajeno')
  await assert.rejects(moveMap(source.handle, destination.handle, 'Mapa.json'), /Ya existe/)
  assert.equal(source.files.get('Mapa.json'), text)
  assert.equal(destination.files.get('Mapa.json'), 'contenido ajeno')
  await assert.rejects(moveMap(source.handle, source.handle, 'Mapa.json'), /ya está/)
  destination.files.clear(); destination.failWrite = true
  await assert.rejects(moveMap(source.handle, destination.handle, 'Mapa.json'))
  assert.equal(source.files.get('Mapa.json'), text)
  assert.equal(destination.files.size, 0)
  destination.failWrite = false
  await moveMap(source.handle, destination.handle, 'Mapa.json')
  assert.equal(source.files.size, 0); assert.equal(destination.files.get('Mapa.json'), text)
})

test('copiar en la misma carpeta genera nombres distintos sin tocar el original', async () => {
  const directory = new MemoryDirectory()
  const data = newDocument(); data.nodeData.topic = 'Original'
  const text = JSON.stringify(data); directory.files.set('Original.json', text)
  await copyMap(directory.handle, directory.handle, 'Original.json')
  await copyMap(directory.handle, directory.handle, 'Original.json')
  assert.equal(directory.files.get('Original.json'), text)
  const copy = parseDocument(directory.files.get('Original (copia).json')!)
  assert.equal(copy.nodeData.topic, 'Original (copia)')
  assert.notEqual(copy.nodeData.id, data.nodeData.id)
  assert.ok(directory.files.has('Original (copia 2).json'))
})

test('copiar títulos largos no queda atrapado al truncar el nombre de archivo', async () => {
  const directory = new MemoryDirectory()
  const data = newDocument(); data.nodeData.topic = 'A'.repeat(200)
  const original = 'A'.repeat(180) + '.json'
  directory.files.set(original, JSON.stringify(data))
  await copyMap(directory.handle, directory.handle, original)
  assert.equal(directory.files.size, 2)
  assert.ok([...directory.files.keys()].some(name => name.includes('(copia)')))
})
