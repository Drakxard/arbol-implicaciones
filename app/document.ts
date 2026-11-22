import type { MindElixirData, NodeObj } from 'mind-elixir'

export type EditorSettings = {
  formatVersion: 1
  createdAt: string
  updatedAt: string
  theme: 'Latte' | 'Claro' | 'Oscuro'
  branchStyle: 'curve' | 'straight' | 'orthogonal'
  fontFamily: string
  textColor: string
  source: string
}

export function defaultSettings(): EditorSettings {
  const now = new Date().toISOString()
  return { formatVersion: 1, createdAt: now, updatedAt: now, theme: 'Latte', branchStyle: 'curve',
    fontFamily: 'Times New Roman', textColor: '', source: '' }
}

export function newDocument(): MindElixirData {
  return { nodeData: { id: crypto.randomUUID(), topic: 'Nuevo Mapa Mental' }, direction: 1,
    meta: { editor: defaultSettings() } }
}

export function settingsFrom(data: MindElixirData): EditorSettings {
  const raw = data.meta?.editor ?? {}
  if (raw.formatVersion !== undefined && raw.formatVersion !== 1) throw new Error('Este archivo usa una versión de formato no compatible.')
  const defaults = defaultSettings()
  return {
    ...defaults,
    createdAt: typeof raw.createdAt === 'string' && Number.isFinite(Date.parse(raw.createdAt)) ? raw.createdAt : defaults.createdAt,
    updatedAt: typeof raw.updatedAt === 'string' && Number.isFinite(Date.parse(raw.updatedAt)) ? raw.updatedAt : defaults.updatedAt,
    theme: ['Latte', 'Claro', 'Oscuro'].includes(raw.theme) ? raw.theme : 'Latte',
    branchStyle: ['curve', 'straight', 'orthogonal'].includes(raw.branchStyle) ? raw.branchStyle : 'curve',
    fontFamily: typeof raw.fontFamily === 'string' ? raw.fontFamily : defaults.fontFamily,
    textColor: typeof raw.textColor === 'string' ? raw.textColor : '',
    source: typeof raw.source === 'string' ? raw.source : '',
  }
}

export function safeLink(value: string): boolean {
  try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false }
}

export function safeImage(value: string): boolean {
  return safeLink(value) || /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(value)
}

export function parseDocument(text: string): MindElixirData {
  let data: MindElixirData
  try { data = JSON.parse(text) } catch { throw new Error('El archivo no contiene JSON válido. No se sobrescribirá.') }
  const invalid = () => { throw new Error('El archivo contiene un mapa inválido. No se sobrescribirá.') }
  if (!data || typeof data !== 'object' || !data.nodeData) invalid()
  const nodes = new Map<string, NodeObj>()
  function visit(node: NodeObj, depth: number) {
    if (!node || typeof node !== 'object' || typeof node.id !== 'string' || !/^[\w-]+$/.test(node.id) ||
      nodes.has(node.id) || typeof node.topic !== 'string' || depth > 100 || nodes.size >= 10000 ||
      'dangerouslySetInnerHTML' in node || 'parent' in node) invalid()
    nodes.set(node.id, node)
    if (node.note !== undefined && typeof node.note !== 'string') invalid()
    if (node.children !== undefined && !Array.isArray(node.children)) invalid()
    if (node.style !== undefined && (!node.style || typeof node.style !== 'object' || Array.isArray(node.style) || Object.values(node.style).some(v => typeof v !== 'string'))) invalid()
    if (node.expanded !== undefined && typeof node.expanded !== 'boolean') invalid()
    if (node.direction !== undefined && node.direction !== 0 && node.direction !== 1) invalid()
    if (node.icons !== undefined && (!Array.isArray(node.icons) || node.icons.some(v => typeof v !== 'string'))) invalid()
    if (node.tags !== undefined && (!Array.isArray(node.tags) || node.tags.some(v => typeof v !== 'string' && (!v || typeof v.text !== 'string')))) invalid()
    if (node.hyperLink && !safeLink(node.hyperLink)) invalid()
    if (node.image && (!safeImage(node.image.url) || !Number.isFinite(node.image.width) || !Number.isFinite(node.image.height) || node.image.width <= 0 || node.image.height <= 0)) invalid()
    for (const child of node.children ?? []) visit(child, depth + 1)
  }
  visit(data.nodeData, 0)
  if (data.direction !== undefined && ![0, 1, 2, 3].includes(data.direction)) invalid()
  if (data.compact !== undefined && typeof data.compact !== 'boolean') invalid()
  if (data.theme !== undefined && (!data.theme || typeof data.theme.name !== 'string' || !Array.isArray(data.theme.palette) || data.theme.palette.some(v => typeof v !== 'string') ||
    (data.theme.cssVar && Object.values(data.theme.cssVar).some(v => typeof v !== 'string')))) invalid()
  if (data.arrows !== undefined && !Array.isArray(data.arrows)) invalid()
  const ids = new Set<string>()
  for (const arrow of data.arrows ?? []) {
    if (!arrow || typeof arrow.id !== 'string' || ids.has(arrow.id) || typeof arrow.label !== 'string' || !nodes.has(arrow.from) || !nodes.has(arrow.to) || 'dangerouslySetInnerHTML' in arrow) invalid()
    ids.add(arrow.id)
  }
  if (data.summaries !== undefined && !Array.isArray(data.summaries)) invalid()
  for (const item of data.summaries ?? []) {
    if (!item || typeof item.id !== 'string' || typeof item.label !== 'string' || !nodes.has(item.parent) || !Number.isInteger(item.start) || !Number.isInteger(item.end) ||
      item.start < 0 || item.end < item.start || item.end >= (nodes.get(item.parent)?.children?.length ?? 0)) invalid()
  }
  data.meta = { ...data.meta, editor: settingsFrom(data) }
  return data
}
