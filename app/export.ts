import MindElixir, { type MindElixirData, type NodeObj } from 'mind-elixir'
import { parse, type Font } from 'opentype.js'
import { settingsFrom } from './document'
import { withTextDefaults } from './defaults'
import { themeFor, styleDescendants } from './appearance'
import { renderMarkdown } from './markdown'

const ns = 'http://www.w3.org/2000/svg'
const fontUrls = import.meta.glob<string>([
  '../node_modules/@fontsource/*/files/*-latin-400-normal.woff',
  '../node_modules/@fontsource/*/files/*-latin-400-italic.woff',
  '../node_modules/@fontsource/*/files/*-latin-700-normal.woff',
  '../node_modules/@fontsource/*/files/*-latin-700-italic.woff',
  '../node_modules/katex/dist/fonts/*.ttf',
], { query: '?url', import: 'default', eager: true })
const fonts = new Map<string, Promise<Font>>()
const canvas = document.createElement('canvas')
const context = canvas.getContext('2d')!
function svgElement(name: string, attrs: Record<string, string | number> = {}) {
  const element = document.createElementNS(ns, name)
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value))
  return element
}
async function fontFor(style: CSSStyleDeclaration) {
  const family = style.fontFamily.split(',')[0].replace(/["']/g, '').trim()
  const bold = Number(style.fontWeight) >= 600
  const italic = style.fontStyle === 'italic'
  let name: string
  if (family.startsWith('KaTeX_')) {
    const suffix = bold && italic ? 'BoldItalic' : bold ? 'Bold' : italic ? 'Italic' : 'Regular'
    name = `${family}-${suffix}.ttf`
    if (!Object.keys(fontUrls).some(key => key.endsWith('/' + name))) name = `${family}-Regular.ttf`
  } else {
    const face = /mono|courier/i.test(family) ? 'sans-mono' : /sans|arial/i.test(family) ? 'sans' : 'serif'
    name = `noto-${face}-latin-${bold ? 700 : 400}-${italic && face !== 'sans-mono' ? 'italic' : 'normal'}.woff`
  }
  const url = Object.entries(fontUrls).find(([key]) => key.endsWith('/' + name))?.[1]
  if (!url) throw new Error(`No se pudo exportar la fuente ${family}.`)
  if (!fonts.has(url)) fonts.set(url, fetch(url).then(async response => {
    if (!response.ok) throw new Error('No se pudo cargar una fuente de exportación.')
    return parse(await response.arrayBuffer())
  }))
  return fonts.get(url)!
}
async function loadExportFonts() {
  // Use the same redistributable fonts for layout and for vector outlines.
  await Promise.all(Object.entries(fontUrls).filter(([key]) => key.endsWith('.woff')).map(async ([key, url]) => {
    const family = key.includes('/noto-sans-mono/') ? 'Export Mono' : key.includes('/noto-sans/') ? 'Export Sans' : 'Export Serif'
    const weight = key.includes('-700-') ? '700' : '400'
    const style = key.includes('-italic.') ? 'italic' : 'normal'
    const face = await new FontFace(family, `url("${url}")`, { weight, style }).load()
    document.fonts.add(face)
  }))
}
function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('No se pudo incrustar una imagen.'))
    reader.readAsDataURL(blob)
  })
}
async function embedImages(node: NodeObj) {
  if (node.image && !node.image.url.startsWith('data:')) {
    const response = await fetch(node.image.url, { signal: AbortSignal.timeout(20000) })
    if (!response.ok) throw new Error('No se pudo descargar una imagen del mapa.')
    node.image.url = await dataUrl(await response.blob())
  }
  node.expanded = true
  await Promise.all((node.children ?? []).map(embedImages))
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}

/** Paint actual browser layout as standalone SVG primitives; no whole-map bitmap or foreignObject. */
async function vectorScene(mind: MindElixir, background: string) {
  const topics = Array.from(mind.container.querySelectorAll<HTMLElement>('.me-tpc, .svg-label'))
  const layers = new Set<Element>([mind.lines, mind.arrowSvg, mind.summarySvg, ...mind.nodes.querySelectorAll('svg.subLines')])
  const bounds = topics.map(element => element.getBoundingClientRect())
  for (const element of [mind.lines, mind.arrowSvg, mind.summarySvg]) {
    for (const shape of element.querySelectorAll<SVGGraphicsElement>('path, text, rect, circle')) {
      const rect = shape.getBoundingClientRect()
      if (rect.width || rect.height) bounds.push(rect)
    }
  }
  const left = Math.min(...bounds.map(rect => rect.left)) - 32
  const top = Math.min(...bounds.map(rect => rect.top)) - 32
  const width = Math.ceil(Math.max(...bounds.map(rect => rect.right)) - left + 32)
  const height = Math.ceil(Math.max(...bounds.map(rect => rect.bottom)) - top + 32)
  const svg = svgElement('svg', { width, height, viewBox: `0 0 ${width} ${height}` })
  svg.append(svgElement('rect', { width, height, fill: background }))
  let glyphs = 0
  async function paint(element: Element, into: Element, skipLayers = false) {
    if (skipLayers && (layers.has(element) || element === mind.labelContainer)) return
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || element.matches('.katex-mathml, .me-epd, .me-epd *')) return
    if (element.matches('.me-tpc, .svg-label')) {
      const group = svgElement('g')
      const node = (element as HTMLElement & { nodeObj?: NodeObj }).nodeObj
      if (node) group.setAttribute('data-node-id', node.id)
      const title = svgElement('title'); title.textContent = node?.topic ?? element.textContent
      group.append(title); into.append(group); into = group
    }
    const rect = element.getBoundingClientRect()
    if (element instanceof SVGSVGElement) {
      const clone = element.cloneNode(true) as SVGSVGElement
      const originals = [element, ...element.querySelectorAll('*')]
      const copies = [clone, ...clone.querySelectorAll('*')]
      originals.forEach((original, index) => {
        const css = getComputedStyle(original)
        for (const prop of ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'fill-rule', 'stroke-linecap', 'stroke-linejoin', 'color']) {
          copies[index].setAttribute(prop, css.getPropertyValue(prop))
        }
        copies[index].removeAttribute('class'); copies[index].removeAttribute('style')
      })
      clone.setAttribute('x', String(rect.left - left)); clone.setAttribute('y', String(rect.top - top))
      clone.setAttribute('width', String(rect.width)); clone.setAttribute('height', String(rect.height))
      into.append(clone); return
    }
    const x = rect.left - left, y = rect.top - top
    if (rect.width && rect.height) {
      if (style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent') {
        into.append(svgElement('rect', { x, y, width: rect.width, height: rect.height, rx: parseFloat(style.borderRadius) || 0, fill: style.backgroundColor }))
      }
      for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) {
        const thickness = parseFloat(style[`border${side}Width`])
        if (!thickness || style[`border${side}Style`] === 'none') continue
        const horizontal = side === 'Top' || side === 'Bottom'
        into.append(svgElement('rect', { x: x + (side === 'Right' ? rect.width - thickness : 0), y: y + (side === 'Bottom' ? rect.height - thickness : 0), width: horizontal ? rect.width : thickness, height: horizontal ? thickness : rect.height, fill: style[`border${side}Color`] }))
      }
    }
    if (element instanceof HTMLImageElement) {
      if (!element.complete || !element.naturalWidth) throw new Error('No se pudo cargar una imagen para exportar.')
      let href = element.src
      if (!href.startsWith('data:')) {
        const response = await fetch(href, { signal: AbortSignal.timeout(20000) })
        if (!response.ok) throw new Error('No se pudo incrustar una imagen externa.')
        href = await dataUrl(await response.blob())
      }
      into.append(svgElement('image', { x, y, width: rect.width, height: rect.height, href, preserveAspectRatio: style.objectFit === 'fill' ? 'none' : style.objectFit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet' }))
      return
    }
    for (const child of element.childNodes) {
      if (child instanceof Element) { await paint(child, into, skipLayers); continue }
      if (child.nodeType !== Node.TEXT_NODE || !child.textContent?.trim()) continue
      const text = child.textContent
      const font = await fontFor(style)
      const size = parseFloat(style.fontSize)
      const range = document.createRange()
      let offset = 0
      // Segment graphemes so emoji sequences remain intact.
      const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)
      for (const { segment } of segments) {
        range.setStart(child, offset); offset += segment.length; range.setEnd(child, offset)
        if (!segment.trim()) continue
        const box = range.getBoundingClientRect()
        if (!box.width || !box.height) continue
        context.font = `${style.fontStyle} ${style.fontWeight} ${size}px ${style.fontFamily}`
        const metrics = context.measureText(segment)
        const baseline = box.top - top + (box.height - metrics.fontBoundingBoxAscent - metrics.fontBoundingBoxDescent) / 2 + metrics.fontBoundingBoxAscent
        if (Array.from(segment).every(char => font.charToGlyphIndex(char) !== 0)) {
          const path = font.getPath(segment, box.left - left, baseline, size)
          into.append(svgElement('path', { d: path.toPathData(3), fill: style.color }))
        } else {
          // Color emoji / unsupported glyphs alone are rasterized, never the tree.
          const tile = document.createElement('canvas')
          tile.width = Math.ceil(box.width * 3 + size * 3); tile.height = Math.ceil(box.height * 3 + size * 3)
          const ctx = tile.getContext('2d')!
          ctx.scale(3, 3); ctx.font = context.font; ctx.fillStyle = style.color
          ctx.fillText(segment, size / 2, baseline - (box.top - top) + size / 2)
          into.append(svgElement('image', { x: box.left - left - size / 2, y: box.top - top - size / 2, width: tile.width / 3, height: tile.height / 3, href: tile.toDataURL() }))
        }
        if (++glyphs % 500 === 0) await new Promise(resolve => setTimeout(resolve, 0))
      }
    }
  }
  // Connections first, then labels and nodes, matching the map's stacking order.
  const connections = svgElement('g', { 'data-layer': 'connections' })
  const content = svgElement('g', { 'data-layer': 'content' })
  svg.append(connections, content)
  for (const element of layers) await paint(element, connections)
  await paint(mind.nodes, content, true)
  for (const element of mind.labelContainer.children) await paint(element, content)
  return { svg, width, height }
}

let busy = false
export async function exportMap(source: MindElixirData, format: 'svg' | 'pdf', progress: (message: string) => void) {
  if (busy) return
  busy = true
  const host = document.createElement('div')
  let renderer: MindElixir | undefined
  try {
    progress('Preparando exportación…')
    const data = structuredClone(source)
    const settings = withTextDefaults(settingsFrom(data))
    await Promise.all([embedImages(data.nodeData), loadExportFonts()])
    host.className = 'export-map'
    host.style.cssText = 'position:fixed;left:-100000px;top:0;width:1600px;height:1200px;pointer-events:none;'
    host.setAttribute('aria-hidden', 'true'); document.body.append(host)
    const family = /mono|courier/i.test(settings.fontFamily) ? 'Export Mono' : /sans|arial/i.test(settings.fontFamily) ? 'Export Sans' : 'Export Serif'
    host.style.setProperty('--map-font', `"${family}"`)
    renderer = new MindElixir({ el: host, toolBar: false, keypress: false, contextMenu: false, editable: false, markdown: renderMarkdown, theme: themeFor(settings) })
    host.style.position = 'fixed'
    data.theme = themeFor(settings)
    const error = await renderer.init(data)
    if (error) throw error
    await document.fonts.ready
    styleDescendants(renderer, settings)
    renderer.scale(1); renderer.linkDiv()
    await Promise.all(Array.from(host.querySelectorAll('img')).map(image => image.decode()))
    progress('Generando archivo vectorial…')
    const { svg, width, height } = await vectorScene(renderer, themeFor(settings).cssVar!['--bgcolor']!)
    const name = source.nodeData.topic.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'Mapa mental'
    if (format === 'svg') download(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' }), `${name}.svg`)
    else {
      const [{ jsPDF }] = await Promise.all([import('jspdf'), import('svg2pdf.js')])
      // PDF page dimensions are limited to 14,400 pt. Scaling the vector scene preserves detail.
      const factor = Math.min(0.75, 14400 / Math.max(width, height))
      const pdf = new jsPDF({ orientation: width > height ? 'landscape' : 'portrait', unit: 'pt', format: [width * factor, height * factor], compress: true })
      host.append(svg)
      await pdf.svg(svg, { x: 0, y: 0, width: width * factor, height: height * factor })
      pdf.save(`${name}.pdf`)
    }
    progress('Exportación completada.')
  } catch (error) {
    throw new Error(`No se pudo exportar el mapa. ${error instanceof Error ? error.message : 'Reintentá la operación.'}`)
  } finally { renderer?.destroy(); host.remove(); busy = false }
}
