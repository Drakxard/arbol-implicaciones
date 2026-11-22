import type { NodeObj } from 'mind-elixir'
import { parseDocument } from './document'
import type { LibraryEntry } from './storage'

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

export async function moveMap(source: FileSystemDirectoryHandle, destination: FileSystemDirectoryHandle, fileName: string) {
  const text = await (await (await source.getFileHandle(fileName)).getFile()).text()
  parseDocument(text)
  try {
    await destination.getFileHandle(fileName)
    throw new Error(`Ya existe «${fileName}» en la carpeta de destino.`)
  } catch (error) { if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error }
  const file = await destination.getFileHandle(fileName, { create: true })
  const stream = await file.createWritable()
  try { await stream.write(text); await stream.close() }
  catch (error) { await stream.abort().catch(() => {}); throw error }
  await source.removeEntry(fileName)
}
