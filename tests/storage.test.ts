import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FolderSession, type DirectoryPort } from '../app/storage'
import { newDocument, parseDocument, settingsFrom } from '../app/document'
import type { MindElixirData } from 'mind-elixir'

class FakeDirectory implements DirectoryPort {
  name = 'Mi carpeta'
  permission: PermissionState = 'granted'
  text: string | null = null
  writes: string[] = []
  failRead = false
  failWrite = false
  beforeWrite?: () => Promise<void>
  async queryPermission() { return this.permission }
  async requestPermission() { return this.permission }
  async read() { if (this.failRead) throw new DOMException('Carpeta eliminada', 'NotFoundError'); return this.text }
  async write(text: string) {
    await this.beforeWrite?.()
    if (this.failWrite) throw new DOMException('Sin permiso', 'NotAllowedError')
    this.text = text; this.writes.push(text)
  }
}
function setup(delay = 10) {
  let data = newDocument()
  let loads = 0
  const session = new FolderSession(() => data, async next => { data = next; loads++ }, () => {}, delay)
  const directory = new FakeDirectory()
  return { session, directory, get data() { return data }, get loads() { return loads }, edit(topic: string) { data.nodeData.topic = topic; session.changed() } }
}

test('carpeta vacía: no crea un archivo hasta la primera edición', async () => {
  const s = setup()
  assert.equal(await s.session.connect(s.directory), true)
  await s.session.save()
  assert.equal(s.directory.writes.length, 0)
  assert.equal(s.data.nodeData.topic, 'Nuevo Mapa Mental')
  s.edit('Mi mapa')
  await s.session.save()
  assert.equal(parseDocument(s.directory.text!).nodeData.topic, 'Mi mapa')
  assert.equal(s.session.state, 'saved')
  assert.equal(s.session.dirty, false)
  s.session.dispose()
})
test('carga un archivo existente antes de habilitar escrituras', async () => {
  const s = setup()
  const existing = newDocument(); existing.nodeData.topic = 'Desde el disco'
  s.directory.text = JSON.stringify(existing)
  await s.session.connect(s.directory)
  assert.equal(s.loads, 1)
  assert.equal(s.data.nodeData.topic, 'Desde el disco')
  assert.equal(s.directory.writes.length, 0)
})
test('coalesce cambios rápidos y guarda automáticamente la última revisión', async () => {
  const s = setup()
  await s.session.connect(s.directory)
  s.edit('A'); s.edit('B'); s.edit('Último')
  await new Promise(resolve => setTimeout(resolve, 40))
  assert.equal(s.directory.writes.length, 1)
  assert.equal(parseDocument(s.directory.text!).nodeData.topic, 'Último')
})
test('serializa escrituras y conserva una edición llegada durante el guardado', async () => {
  const s = setup(10000)
  await s.session.connect(s.directory)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let active = 0; let maxActive = 0
  s.directory.beforeWrite = async () => { active++; maxActive = Math.max(maxActive, active); await gate; active-- }
  s.edit('Primero')
  const writing = s.session.save()
  s.edit('Segundo')
  release()
  await writing
  assert.equal(maxActive, 1)
  assert.equal(s.directory.writes.length, 2)
  assert.equal(parseDocument(s.directory.text!).nodeData.topic, 'Segundo')
  assert.equal(s.session.dirty, false)
  s.session.dispose()
})
test('un permiso pendiente o denegado no lee ni escribe y puede renovarse', async () => {
  const s = setup()
  s.directory.permission = 'prompt'
  assert.equal(await s.session.connect(s.directory), false)
  assert.equal(s.session.state, 'permission')
  assert.equal(s.loads, 0)
  s.edit('Pendiente')
  await s.session.save()
  assert.equal(s.directory.text, null)
  s.directory.permission = 'denied'
  assert.equal(await s.session.connect(s.directory, true, true), false)
  s.directory.permission = 'granted'
  await s.session.connect(s.directory, true, true)
  assert.equal(parseDocument(s.directory.text!).nodeData.topic, 'Pendiente')
})
test('JSON inválido bloquea toda sobrescritura, también al reconectar', async () => {
  const s = setup()
  s.directory.text = '{roto'
  assert.equal(await s.session.connect(s.directory), false)
  s.edit('Edición en memoria')
  await s.session.save()
  assert.equal(s.session.state, 'invalid')
  assert.equal(s.directory.text, '{roto')
  assert.equal(await s.session.connect(s.directory, true, true), false)
  assert.equal(s.directory.writes.length, 0)
})
test('carpeta inaccesible no se interpreta como un mapa nuevo', async () => {
  const s = setup()
  s.directory.failRead = true
  await s.session.connect(s.directory)
  assert.equal(s.session.state, 'error')
  assert.equal(s.loads, 0)
  s.edit('Sin guardar'); await s.session.save()
  assert.equal(s.directory.writes.length, 0)
})
test('fallo de escritura conserva cambios y permite reintentar sin cargar una copia antigua', async () => {
  const s = setup()
  await s.session.connect(s.directory)
  s.directory.failWrite = true
  s.edit('No perder esta edición')
  await s.session.save()
  assert.equal(s.session.dirty, true)
  assert.equal(s.session.state, 'permission')
  s.directory.failWrite = false
  await s.session.connect(s.directory, true, true)
  assert.equal(s.loads, 1)
  assert.equal(parseDocument(s.directory.text!).nodeData.topic, 'No perder esta edición')
})
test('JSON conserva imágenes, notas, relaciones, resúmenes y ajustes serializables', () => {
  const data = newDocument()
  data.nodeData.children = [{ id: 'a', topic: 'Uno', note: 'Mi nota', style: { color: '#123456' }, icons: ['⭐'] }, { id: 'b', topic: 'Dos' }]
  data.nodeData.children[0].image = { url: 'data:image/png;base64,aA==', width: 100, height: 80, fit: 'contain' }
  data.arrows = [{ id: 'arrow1', from: 'a', to: 'b', label: 'implica' }] as MindElixirData['arrows']
  data.summaries = [{ id: 'summary1', parent: data.nodeData.id, start: 0, end: 1, label: 'Resumen' }] as MindElixirData['summaries']
  data.meta!.editor.branchStyle = 'orthogonal'
  const parsed = parseDocument(JSON.stringify(data))
  assert.deepEqual(parsed, data)
  assert.equal(settingsFrom(parsed).branchStyle, 'orthogonal')
})
test('rechaza contenido ejecutable, nodos duplicados y versiones futuras', () => {
  const data = newDocument()
  data.nodeData.children = [{ id: data.nodeData.id, topic: 'Repetido' }]
  assert.throws(() => parseDocument(JSON.stringify(data)), /inválido/)
  delete data.nodeData.children
  data.nodeData.dangerouslySetInnerHTML = '<script>alert(1)</script>'
  assert.throws(() => parseDocument(JSON.stringify(data)), /inválido/)
  delete data.nodeData.dangerouslySetInnerHTML
  data.nodeData.hyperLink = 'javascript:alert(1)'
  assert.throws(() => parseDocument(JSON.stringify(data)), /inválido/)
  delete data.nodeData.hyperLink
  data.meta!.editor.formatVersion = 2
  assert.throws(() => parseDocument(JSON.stringify(data)), /formato/)
})
