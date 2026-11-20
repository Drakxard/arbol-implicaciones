import type { MindElixirData, NodeObj } from '../src/types/index'

export const STORAGE_KEY = 'arbol-implicaciones:mapa:v1'

export function validateMap(input: unknown): MindElixirData {
  if (!input || typeof input !== 'object') throw new Error('El archivo no contiene un mapa.')
  const data = structuredClone(input) as MindElixirData
  const ids = new Set<string>()
  const nodes = new Map<string, NodeObj>()
  function visit(node: NodeObj, depth: number) {
    if (!node || typeof node !== 'object' || typeof node.id !== 'string' || !node.id ||
        typeof node.topic !== 'string' || !node.topic.trim() || /["\\\r\n]/.test(node.id) || ids.has(node.id) || depth > 100) {
      throw new Error('El mapa contiene conceptos inválidos, repetidos o demasiado anidados.')
    }
    ids.add(node.id)
    nodes.set(node.id, node)
    // Imported HTML must never run in the browser. Plain text is rendered by the core.
    if ('dangerouslySetInnerHTML' in node || 'parent' in node) throw new Error('El archivo contiene contenido no permitido.')
    if (node.note !== undefined && typeof node.note !== 'string') throw new Error('Las notas deben ser texto.')
    if (node.expanded !== undefined && typeof node.expanded !== 'boolean') throw new Error('Estado de rama inválido.')
    if (node.direction !== undefined && node.direction !== 0 && node.direction !== 1) throw new Error('Dirección de rama inválida.')
    if (node.style !== undefined && (!node.style || typeof node.style !== 'object' || Array.isArray(node.style) ||
        Object.values(node.style).some(value => typeof value !== 'string'))) throw new Error('Estilo de concepto inválido.')
    if (node.icons !== undefined && (!Array.isArray(node.icons) || node.icons.some(icon => typeof icon !== 'string'))) throw new Error('Iconos inválidos.')
    if (node.tags !== undefined && (!Array.isArray(node.tags) || node.tags.some(tag => typeof tag !== 'string' &&
        (!tag || typeof tag !== 'object' || typeof tag.text !== 'string')))) throw new Error('Etiquetas inválidas.')
    if (node.image !== undefined && (!node.image || typeof node.image.url !== 'string' ||
        !/^(https?:\/\/|data:image\/(png|jpeg|gif|webp);base64,)/i.test(node.image.url) ||
        !Number.isFinite(node.image.width) || !Number.isFinite(node.image.height))) throw new Error('Imagen inválida.')
    if (node.hyperLink && !/^https?:\/\//i.test(node.hyperLink)) throw new Error('El enlace debe usar http o https.')
    if (node.children !== undefined && !Array.isArray(node.children)) throw new Error('Las ramas deben ser una lista.')
    for (const child of node.children ?? []) visit(child, depth + 1)
  }
  visit(data.nodeData, 0)
  if (data.theme !== undefined && (!data.theme || typeof data.theme.name !== 'string' || !Array.isArray(data.theme.palette) ||
      data.theme.palette.some(color => typeof color !== 'string') || (data.theme.cssVar !== undefined &&
      (!data.theme.cssVar || typeof data.theme.cssVar !== 'object' || Object.values(data.theme.cssVar).some(v => typeof v !== 'string'))))) {
    throw new Error('Tema visual inválido.')
  }
  if (data.compact !== undefined && typeof data.compact !== 'boolean') throw new Error('Configuración inválida.')
  if (data.direction !== undefined && ![0, 1, 2, 3].includes(data.direction)) throw new Error('Dirección inválida.')
  if (data.arrows !== undefined && !Array.isArray(data.arrows)) throw new Error('Las relaciones deben ser una lista.')
  const arrowIds = new Set<string>()
  for (const arrow of data.arrows ?? []) {
    if (!arrow || typeof arrow.id !== 'string' || arrowIds.has(arrow.id) || typeof arrow.label !== 'string' ||
        !ids.has(arrow.from) || !ids.has(arrow.to) || 'dangerouslySetInnerHTML' in arrow) throw new Error('Hay relaciones inválidas.')
    arrowIds.add(arrow.id)
  }
  if (data.summaries !== undefined && !Array.isArray(data.summaries)) throw new Error('Los resúmenes deben ser una lista.')
  for (const summary of data.summaries ?? []) {
    if (!summary || typeof summary.id !== 'string' || typeof summary.label !== 'string' ||
        !ids.has(summary.parent) || !Number.isInteger(summary.start) || !Number.isInteger(summary.end) ||
        summary.start < 0 || summary.end < summary.start || summary.end >= (nodes.get(summary.parent)?.children?.length ?? 0)) {
      throw new Error('Hay resúmenes inválidos.')
    }
  }
  return data
}

export function saveMap(storage: Pick<Storage, 'setItem'>, data: MindElixirData) {
  storage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export function loadMap(storage: Pick<Storage, 'getItem'>): MindElixirData | null {
  const raw = storage.getItem(STORAGE_KEY)
  return raw ? validateMap(JSON.parse(raw)) : null
}

export function exampleMap(): MindElixirData {
  return {
    nodeData: {
      id: 'root', topic: 'Mi próximo parcial', children: [
        { id: 'conceptos', topic: 'Conceptos fundamentales', children: [{ id: 'definiciones', topic: '¿Cómo lo explico con mis palabras?' }] },
        { id: 'relaciones', topic: 'Relaciones e implicaciones', children: [{ id: 'razones', topic: '¿Por qué se sigue esta conclusión?' }] },
        { id: 'practica', topic: 'Ejemplos y ejercicios', children: [{ id: 'preguntas', topic: '¿Puedo resolverlo sin mirar?' }] },
      ],
    },
    direction: 2,
  }
}
