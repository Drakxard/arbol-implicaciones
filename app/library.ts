import type { MindElixirData, NodeObj } from 'mind-elixir'
import { parseDocument, settingsFrom } from './document'
import { mapFileName, type LibraryEntry } from './storage'

export function validFolderName(name: string) {
  return !!name && name.length <= 180 && !/[<>:"/\\|?*\u0000-\u001f]/.test(name) &&
    !/[. ]$/.test(name) && !['.', '..', '.papelera'].includes(name.toLocaleLowerCase()) &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
}

export async function directoryAt(root: FileSystemDirectoryHandle, path: string[], create = false) {
  let directory = root
  for (const name of path) {
    if (!validFolderName(name)) throw new Error('La ruta de la carpeta no es válida.')
    directory = await directory.getDirectoryHandle(name, { create })
  }
  return directory
}

export async function listFolders(directory: FileSystemDirectoryHandle) {
  const folders: string[] = []
  for await (const entry of (directory as unknown as { values(): AsyncIterableIterator<FileSystemHandle> }).values()) {
    if (entry.kind === 'directory' && entry.name.toLocaleLowerCase() !== '.papelera' && await isLibraryFolder(entry as FileSystemDirectoryHandle)) folders.push(entry.name)
  }
  return folders.sort((a, b) => a.localeCompare(b, 'es', { numeric: true }))
}

export const FOLDER_MARKER = '.arbol-folder.json'
const folderMarker = { application: 'arbol-implicaciones', kind: 'library-folder', version: 1 }
async function isLibraryFolder(directory: FileSystemDirectoryHandle) {
  try {
    const data = JSON.parse(await (await (await directory.getFileHandle(FOLDER_MARKER)).getFile()).text())
    return data?.application === folderMarker.application && data?.kind === folderMarker.kind && data?.version === 1
  } catch { return false }
}

export async function createLibraryFolder(directory: FileSystemDirectoryHandle, name: string) {
  if (!validFolderName(name)) throw new Error('Escribí un nombre de carpeta válido, sin barras ni caracteres especiales.')
  for await (const entry of (directory as unknown as { values(): AsyncIterableIterator<FileSystemHandle> }).values()) {
    if (entry.name.toLocaleLowerCase() === name.toLocaleLowerCase() &&
      (entry.kind !== 'directory' || await isLibraryFolder(entry as FileSystemDirectoryHandle))) throw new Error('Ya existe un archivo o carpeta con ese nombre.')
  }
  const folder = await directory.getDirectoryHandle(name, { create: true })
  try {
    await folder.getFileHandle(FOLDER_MARKER)
    throw new Error('Esta carpeta contiene un archivo de identificación incompatible. No se modificó.')
  } catch (error) { if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error }
  const stream = await (await folder.getFileHandle(FOLDER_MARKER, { create: true })).createWritable()
  try { await stream.write(JSON.stringify(folderMarker)); await stream.close() }
  catch (error) { await stream.abort().catch(() => {}); throw error }
}

/** Copies are independent documents, including internal relationship identifiers. */
export function independentCopy(source: MindElixirData): MindElixirData {
  const data = structuredClone(source)
  const ids = new Map<string, string>()
  function visit(node: NodeObj) {
    const id = crypto.randomUUID(); ids.set(node.id, id); node.id = id
    node.children?.forEach(visit)
  }
  visit(data.nodeData)
  for (const arrow of data.arrows ?? []) {
    arrow.id = crypto.randomUUID(); arrow.from = ids.get(arrow.from)!; arrow.to = ids.get(arrow.to)!
  }
  for (const summary of data.summaries ?? []) {
    summary.id = crypto.randomUUID(); summary.parent = ids.get(summary.parent)!
  }
  const now = new Date().toISOString()
  data.meta = { ...data.meta, editor: { ...settingsFrom(data), createdAt: now, updatedAt: now } }
  return data
}

/** Small inert preview: SVG text is assigned as text, never as markup. */
export function mapPreview(entry: LibraryEntry) {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('aria-hidden', 'true')
  const group = document.createElementNS(ns, 'g')
  svg.append(group)
  let row = 0
  let maxDepth = 0
  const nodes: { node: NodeObj; x: number; y: number; parent?: number }[] = []
  function visit(node: NodeObj, depth: number, parent?: number) {
    if (nodes.length >= 60) return
    maxDepth = Math.max(maxDepth, depth)
    const i = nodes.length
    nodes.push({ node, x: depth * 160, y: row * 40, parent })
    if (node.children?.length && node.expanded !== false) {
      const first = row
      node.children.forEach(child => visit(child, depth + 1, i))
      nodes[i].y = (first + Math.max(first, row - 1)) * 20
    } else row++
  }
  visit(entry.data.nodeData, 0)
  for (const item of nodes) {
    if (item.parent !== undefined) {
      const parent = nodes[item.parent]
      const path = document.createElementNS(ns, 'path')
      path.setAttribute('d', `M${parent.x + 120} ${parent.y + 12} C${parent.x + 145} ${parent.y + 12},${item.x - 25} ${item.y + 12},${item.x} ${item.y + 12}`)
      path.setAttribute('fill', 'none'); path.setAttribute('stroke', '#e8a2b4')
      group.append(path)
    }
  }
  for (const { node, x, y, parent } of nodes) {
    const rect = document.createElementNS(ns, 'rect')
    rect.setAttribute('x', String(x)); rect.setAttribute('y', String(y))
    rect.setAttribute('width', '120'); rect.setAttribute('height', '24'); rect.setAttribute('rx', '10')
    rect.setAttribute('fill', parent === undefined ? '#4c4f69' : '#fff')
    rect.setAttribute('stroke', parent === undefined ? '#4c4f69' : '#edbfd0')
    const text = document.createElementNS(ns, 'text')
    text.textContent = node.topic.length > 23 ? node.topic.slice(0, 22) + '…' : node.topic
    text.setAttribute('x', String(x + 60)); text.setAttribute('y', String(y + 16))
    text.setAttribute('text-anchor', 'middle'); text.setAttribute('font-size', '10')
    text.setAttribute('fill', parent === undefined ? '#fff' : '#555')
    group.append(rect, text)
  }
  svg.setAttribute('viewBox', `-20 -20 ${maxDepth * 160 + 160} ${Math.max(row, 1) * 40 + 20}`)
  return svg
}

export async function moveMap(source: FileSystemDirectoryHandle, destination: FileSystemDirectoryHandle, fileName: string, targetName = fileName) {
  if (await source.isSameEntry(destination) && fileName === targetName) throw new Error('El mapa ya está en esta carpeta.')
  const text = await (await (await source.getFileHandle(fileName)).getFile()).text()
  parseDocument(text)
  await writeNewMap(destination, targetName, text)
  await source.removeEntry(fileName)
}

async function writeNewMap(destination: FileSystemDirectoryHandle, fileName: string, text: string) {
  try {
    await destination.getFileHandle(fileName)
    throw new Error(`Ya existe «${fileName}» en la carpeta de destino.`)
  } catch (error) { if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error }
  const file = await destination.getFileHandle(fileName, { create: true })
  try {
    const stream = await file.createWritable()
    try { await stream.write(text); await stream.close() }
    catch (error) { await stream.abort().catch(() => {}); throw error }
  } catch (error) {
    await destination.removeEntry(fileName).catch(() => {})
    throw error
  }
}

export async function copyMap(source: FileSystemDirectoryHandle, destination: FileSystemDirectoryHandle, fileName: string) {
  const original = parseDocument(await (await (await source.getFileHandle(fileName)).getFile()).text())
  const data = independentCopy(original)
  const names = new Set<string>()
  for await (const entry of (destination as unknown as { values(): AsyncIterableIterator<FileSystemHandle> }).values()) names.add(entry.name.toLocaleLowerCase())
  let topic = original.nodeData.topic
  let counter = 1
  while (names.has(mapFileName(topic).toLocaleLowerCase())) {
    topic = `${original.nodeData.topic.slice(0, 150)} (copia${counter === 1 ? '' : ` ${counter}`})`
    counter++
  }
  data.nodeData.topic = topic
  await writeNewMap(destination, mapFileName(topic), JSON.stringify(data, null, 2))
}

export interface TrashedMap extends LibraryEntry { path: string[] }
export async function listTrash(root: FileSystemDirectoryHandle): Promise<TrashedMap[]> {
  let trash: FileSystemDirectoryHandle
  try { trash = await root.getDirectoryHandle('.papelera') }
  catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') return []; throw error }
  const maps: TrashedMap[] = []
  async function visit(directory: FileSystemDirectoryHandle, path: string[]) {
    for await (const entry of (directory as unknown as { values(): AsyncIterableIterator<FileSystemHandle> }).values()) {
      if (entry.kind === 'directory') await visit(entry as FileSystemDirectoryHandle, [...path, entry.name])
      else if (entry.name.endsWith('.json')) {
        const text = await (await (entry as FileSystemFileHandle).getFile()).text()
        try { maps.push({ fileName: entry.name, path, data: parseDocument(text) }) } catch { /* Other files are never deleted as maps. */ }
      }
    }
  }
  await visit(trash, [])
  return maps.sort((a, b) => (b.data.meta?.editor?.updatedAt ?? '').localeCompare(a.data.meta?.editor?.updatedAt ?? ''))
}

export async function trashMap(root: FileSystemDirectoryHandle, path: string[], fileName: string) {
  const source = await directoryAt(root, path)
  const trash = await root.getDirectoryHandle('.papelera', { create: true })
  const destination = await directoryAt(trash, path, true)
  let target = fileName, counter = 2
  const names = new Set<string>()
  for await (const entry of (destination as unknown as { values(): AsyncIterableIterator<FileSystemHandle> }).values()) names.add(entry.name.toLocaleLowerCase())
  while (names.has(target.toLocaleLowerCase())) target = `${fileName.slice(0, -5)} (${counter++}).json`
  await moveMap(source, destination, fileName, target)
}

export async function restoreMap(root: FileSystemDirectoryHandle, entry: TrashedMap) {
  const trash = await root.getDirectoryHandle('.papelera')
  const source = await directoryAt(trash, entry.path)
  let destination: FileSystemDirectoryHandle = root
  for (const name of entry.path) {
    const child = await directoryAt(destination, [name], true)
    if (!await isLibraryFolder(child)) await createLibraryFolder(destination, name)
    destination = child
  }
  await moveMap(source, destination, entry.fileName, mapFileName(entry.data.nodeData.topic))
}

export async function deleteTrashedMap(root: FileSystemDirectoryHandle, entry: TrashedMap) {
  // Only a single validated map inside the selected library's trash is removed.
  if (!entry.fileName.endsWith('.json') || /[/\\]/.test(entry.fileName)) throw new Error('El archivo no es un mapa de la papelera.')
  const trash = await root.getDirectoryHandle('.papelera')
  const directory = await directoryAt(trash, entry.path)
  parseDocument(await (await (await directory.getFileHandle(entry.fileName)).getFile()).text())
  await directory.removeEntry(entry.fileName)
}
