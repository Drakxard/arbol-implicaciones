import MindElixir, { type NodeObj } from 'mind-elixir'
import { renderMarkdown } from './markdown'
import { walkSteps, walkHighlight, type WalkStep } from './walk'
import { textColor } from './appearance'
import type { EditorSettings } from './document'

export function installNavigation(mind: MindElixir, available: () => boolean, getSettings: () => EditorSettings) {
  const element = (id: string) => document.getElementById(id)!
  const host = element('walk-map')
  const button = element('walk-button')
  const focusButton = element('walk-focus')
  let viewer: MindElixir | undefined
  let steps: WalkStep[] = []
  let index = 0
  let focus = false
  let frame = 0
  let tree: NodeObj
  let animation: Animation | undefined
  const disabled = new Map<HTMLButtonElement, boolean>()

  // Core batches same-color edges into compound SVG paths. Separate their subpaths
  // so each child connection can fade independently without changing its geometry.
  function labelEdges() {
    if (!viewer) return
    const branches = viewer.nodes.querySelectorAll<HTMLElement>('.me-main > .me-wrapper')
    branches.forEach((branch, index) => {
      const nodes = Array.from(branch.querySelectorAll<HTMLElement & { nodeObj: NodeObj }>('.me-tpc'))
      const main = viewer!.lines.children[index] as SVGPathElement | undefined
      if (main) main.dataset.walkEdge = nodes[0].nodeObj.id
      let childIndex = 1
      for (const path of branch.querySelectorAll<SVGPathElement>(':scope > .subLines > path')) {
        const parts = path.getAttribute('d')?.match(/[Mm][^Mm]*/g) ?? []
        const fragment = document.createDocumentFragment()
        for (const part of parts) {
          const edge = path.cloneNode(false) as SVGPathElement
          edge.setAttribute('d', part)
          if (nodes[childIndex]) edge.dataset.walkEdge = nodes[childIndex++].nodeObj.id
          fragment.append(edge)
        }
        path.replaceWith(fragment)
      }
    })
    highlight()
  }

  function highlight() {
    if (!viewer) return
    const state = walkHighlight(tree, steps[index], focus)
    for (const node of viewer.container.querySelectorAll<HTMLElement & { nodeObj: NodeObj }>('.me-tpc')) {
      node.classList.toggle('walk-local', state.local.has(node.nodeObj.id))
      node.classList.toggle('walk-trail', state.trail.has(node.nodeObj.id))
      node.classList.toggle('walk-current', node.nodeObj.id === steps[index].activeId)
    }
    for (const edge of viewer.container.querySelectorAll<SVGPathElement>('[data-walk-edge]')) {
      edge.classList.toggle('walk-lit', state.edges.has(edge.dataset.walkEdge!))
    }
  }

  function fit() {
    if (!viewer) return
    const nodes = Array.from(viewer.container.querySelectorAll<HTMLElement>(focus ? '.walk-local' : '.walk-local, .walk-trail'))
    if (!nodes.length) return
    const previous = getComputedStyle(viewer.map).transform
    animation?.cancel()
    viewer.map.style.transition = 'none'
    // Keep the root path in view; the sight button brings the leaf and parent closer.
    const bounds = host.getBoundingClientRect()
    viewer.scale(1)
    const boxes = nodes.map(node => node.getBoundingClientRect())
    const left = Math.min(...boxes.map(box => box.left))
    const top = Math.min(...boxes.map(box => box.top))
    const right = Math.max(...boxes.map(box => box.right))
    const bottom = Math.max(...boxes.map(box => box.bottom))
    viewer.scale(Math.max(.05, Math.min(1.4, (bounds.width - 180) / (right - left), (bounds.height - 180) / (bottom - top))))
    const scaled = nodes.map(node => node.getBoundingClientRect())
    const x = (Math.min(...scaled.map(box => box.left)) + Math.max(...scaled.map(box => box.right))) / 2
    const y = (Math.min(...scaled.map(box => box.top)) + Math.max(...scaled.map(box => box.bottom))) / 2
    viewer.move(bounds.left + bounds.width / 2 + 25 - x, bounds.top + bounds.height / 2 - y)
    if (previous !== 'none' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      animation = viewer.map.animate([{ transform: previous }, { transform: viewer.map.style.transform }], { duration: 240, easing: 'ease-out' })
    }
  }

  function render() {
    if (!viewer) return
    highlight()
    element('walk-status').textContent = `${index + 1} / ${steps.length}`
    ;(element('walk-prev') as HTMLButtonElement).disabled = index === 0
    ;(element('walk-next') as HTMLButtonElement).disabled = index === steps.length - 1
    focusButton.setAttribute('aria-pressed', String(focus))
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(fit)
  }

  function stop() {
    if (!viewer) return
    cancelAnimationFrame(frame)
    animation?.cancel()
    viewer.destroy()
    viewer = undefined
    host.hidden = true
    element('map').hidden = false
    element('walk-controls').hidden = true
    element('editor').classList.remove('walking')
    button.setAttribute('aria-pressed', 'false')
    for (const [control, value] of disabled) control.disabled = value
    disabled.clear()
    element('global-panel').inert = element('map').inert
    element('node-panel').inert = element('map').inert
    mind.container.focus({ preventScroll: true })
  }

  function toggle() {
    if (viewer) { stop(); return }
    if (!available()) return
    // Project a snapshot into a separate read-only canvas: no changes to history or files.
    const data = mind.getData()
    const settings = getSettings()
    const originals = new Map(Array.from(mind.container.querySelectorAll<HTMLElement & { nodeObj: NodeObj }>('.me-tpc'), node => [node.nodeObj.id, node]))
    function preserve(node: NodeObj, parent?: NodeObj) {
      const original = originals.get(node.id)
      if (original) {
        const css = getComputedStyle(original)
        node.style = { ...node.style, color: css.color, fontSize: css.fontSize, background: css.backgroundColor }
      } else {
        node.style = { ...node.style, color: textColor({ ...node, parent }, settings, mind.container),
          fontSize: node.style?.fontSize || `${settings.descendantFontSize ?? 16}px` }
      }
      node.expanded = true
      const ancestor = { ...node, parent }
      node.children?.forEach(child => preserve(child, ancestor))
    }
    preserve(data.nodeData)
    tree = data.nodeData
    steps = walkSteps(data.nodeData)
    index = 0
    host.style.setProperty('--map-font', element('map').style.getPropertyValue('--map-font'))
    element('map').hidden = true
    host.hidden = false
    viewer = new MindElixir({ el: host, editable: false, keypress: false, contextMenu: false, toolBar: false,
      allowUndo: false, direction: mind.direction, compact: mind.compact, theme: mind.theme,
      markdown: renderMarkdown, scaleMin: .05, scaleMax: 5 })
    const currentViewer = viewer
    viewer.bus.addListener('linkDiv', labelEdges)
    void viewer.init({ nodeData: tree, arrows: data.arrows, summaries: data.summaries }).then(() => {
      if (viewer === currentViewer) render()
    })
    element('walk-controls').hidden = false
    element('editor').classList.add('walking')
    button.setAttribute('aria-pressed', 'true')
    for (const id of ['undo', 'redo', 'layout-left', 'layout-right', 'layout-side', 'outline-button', 'search-button']) {
      const control = element(id) as HTMLButtonElement
      disabled.set(control, control.disabled)
      control.disabled = true
    }
    element('search-panel').hidden = true
    element('search-button').setAttribute('aria-expanded', 'false')
    element('global-panel').inert = true
    element('node-panel').inert = true
    viewer.container.focus({ preventScroll: true })
  }

  function advance(delta: number) {
    const next = Math.max(0, Math.min(steps.length - 1, index + delta))
    if (next !== index) { index = next; render() }
  }
  button.addEventListener('click', toggle)
  element('walk-close').addEventListener('click', stop)
  element('walk-prev').addEventListener('click', () => advance(-1))
  element('walk-next').addEventListener('click', () => advance(1))
  focusButton.addEventListener('click', () => { focus = !focus; render() })
  const observer = new ResizeObserver(() => {
    if (viewer) { cancelAnimationFrame(frame); frame = requestAnimationFrame(fit) }
  })
  observer.observe(host)
  return { toggle, stop, fit, get active() { return !!viewer }, get canvas() { return viewer ?? mind },
    key(event: KeyboardEvent) {
      if (!viewer || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false
      if (!['ArrowDown', 'ArrowUp', 'Escape'].includes(event.key)) return false
      if (event.key === 'Escape') stop()
      else advance(event.key === 'ArrowDown' ? 1 : -1)
      return true
    } }
}
