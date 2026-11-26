import MindElixir, { type NodeObj } from 'mind-elixir'
import { renderMarkdown } from './markdown'
import { walkSteps, walkHighlight, walkFrame, type WalkStep } from './walk'
import { textColor } from './appearance'
import { branchContext, nodePath } from './ai-context'
import type { EditorSettings } from './document'

export function installNavigation(mind: MindElixir, available: () => boolean, getSettings: () => EditorSettings,
  editTopic: (id: string, topic: string) => void, report: (message: string) => void) {
  const element = (id: string) => document.getElementById(id)!
  const host = element('walk-map')
  const button = element('walk-button')
  let viewer: MindElixir | undefined
  let steps: WalkStep[] = []
  let index = 0
  let targetId = ''
  let revision = 0
  let cameraDepth = 0
  let frame = 0
  let tree: NodeObj
  let animation: Animation | undefined
  let editing: { field: HTMLTextAreaElement; id: string; original: string } | undefined
  let deferredSync: (() => void) | undefined
  const editWaiters = new Set<() => void>()
  const disabled = new Map<HTMLButtonElement, boolean>()

  function source() {
    const data = mind.getData()
    const settings = getSettings()
    const originals = new Map(Array.from(mind.container.querySelectorAll<HTMLElement & { nodeObj: NodeObj }>('.me-tpc'), node => [node.nodeObj.id, node]))
    function preserve(node: NodeObj, parent?: NodeObj) {
      const original = originals.get(node.id)
      if (original) {
        const css = getComputedStyle(original)
        node.style = { ...node.style, color: css.color, fontSize: css.fontSize, background: css.backgroundColor }
      } else {
        node.style = { ...node.style, color: textColor({ ...node, parent }, settings, mind.container), fontSize: node.style?.fontSize || `${settings.descendantFontSize ?? 16}px` }
      }
      node.expanded = true
      const ancestor = { ...node, parent }
      node.children?.forEach(child => preserve(child, ancestor))
    }
    preserve(data.nodeData)
    return data
  }
  // Core batches same-color edges into compound SVG paths. Split them without
  // changing geometry so each child's connection can fade independently.
  function labelEdges() {
    if (!viewer) return
    viewer.nodes.querySelectorAll<HTMLElement>('.me-main > .me-wrapper').forEach((branch, index) => {
      const nodes = Array.from(branch.querySelectorAll<HTMLElement & { nodeObj: NodeObj }>('.me-tpc'))
      const main = viewer!.lines.children[index] as SVGPathElement | undefined
      if (main) main.dataset.walkEdge = nodes[0].nodeObj.id
      let childIndex = 1
      for (const path of branch.querySelectorAll<SVGPathElement>(':scope > .subLines > path')) {
        const fragment = document.createDocumentFragment()
        for (const part of path.getAttribute('d')?.match(/[Mm][^Mm]*/g) ?? []) {
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
    // The tour owns the destination outline; clear Core's pointer selection.
    viewer.clearSelection()
    const state = walkHighlight(tree, steps[index], false)
    for (const node of viewer.container.querySelectorAll<HTMLElement & { nodeObj: NodeObj }>('.me-tpc')) {
      node.classList.toggle('walk-local', state.local.has(node.nodeObj.id))
      node.classList.toggle('walk-trail', state.trail.has(node.nodeObj.id))
      node.classList.toggle('walk-current', node.nodeObj.id === targetId)
    }
    for (const edge of viewer.container.querySelectorAll<SVGPathElement>('[data-walk-edge]')) edge.classList.toggle('walk-lit', state.edges.has(edge.dataset.walkEdge!))
  }
  function fit() {
    if (!viewer || editing) return
    const camera = walkFrame(tree, steps[index], cameraDepth, false)
    const nodes = Array.from(viewer.container.querySelectorAll<HTMLElement & { nodeObj: NodeObj }>('.me-tpc')).filter(node => camera.ids.has(node.nodeObj.id))
    if (!nodes.length) return
    const previous = getComputedStyle(viewer.map).transform
    animation?.cancel()
    viewer.map.style.transition = 'none'
    const bounds = host.getBoundingClientRect()
    const composer = element('ai-composer')
    const reserved = composer.hidden ? 0 : 170
    const height = Math.max(100, bounds.height - reserved)
    viewer.scale(1)
    const boxes = nodes.map(node => node.getBoundingClientRect())
    const width = Math.max(...boxes.map(box => box.right)) - Math.min(...boxes.map(box => box.left))
    const extent = Math.max(...boxes.map(box => box.bottom)) - Math.min(...boxes.map(box => box.top))
    viewer.scale(Math.max(.05, Math.min(1.4, (bounds.width - 180) / width, (height - 160) / extent)))
    const scaled = nodes.map(node => node.getBoundingClientRect())
    const x = (Math.min(...scaled.map(box => box.left)) + Math.max(...scaled.map(box => box.right))) / 2
    const y = (Math.min(...scaled.map(box => box.top)) + Math.max(...scaled.map(box => box.bottom))) / 2
    viewer.move(bounds.left + bounds.width / 2 + 25 - x, bounds.top + height / 2 - y)
    if (previous !== 'none' && !matchMedia('(prefers-reduced-motion: reduce)').matches) animation = viewer.map.animate([{ transform: previous }, { transform: viewer.map.style.transform }], { duration: 240, easing: 'ease-out' })
  }
  function render() {
    if (!viewer) return
    highlight()
    const camera = walkFrame(tree, steps[index], cameraDepth, false)
    cameraDepth = camera.depth
    Object.assign(host.dataset, { step: String(index + 1), total: String(steps.length), depth: String(cameraDepth), cameraRoot: camera.rootId, target: targetId })
    element('walk-status').textContent = `Recorrido: ${index + 1} de ${steps.length}. Encuadre: nivel ${cameraDepth}.`
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(fit)
  }
  function sync(preferredLeaf?: string, preferredTarget?: string) {
    if (!viewer) return
    if (editing) { deferredSync = () => sync(preferredLeaf, preferredTarget); return }
    const previousPath = nodePath(tree, steps[index].activeId).map(node => node.id).reverse()
    const previousLeaf = steps[index].activeId
    const previousTarget = targetId
    const data = source()
    tree = data.nodeData
    steps = walkSteps(tree)
    let next = steps.findIndex(step => step.activeId === (preferredLeaf ?? previousLeaf))
    if (next < 0) {
      const ancestor = previousPath.find(id => nodePath(tree, id).length)
      next = steps.findIndex(step => ancestor && nodePath(tree, step.activeId).some(node => node.id === ancestor))
    }
    index = Math.max(0, next)
    const state = walkHighlight(tree, steps[index], false)
    const desired = preferredTarget ?? (preferredLeaf ? steps[index].activeId : previousTarget)
    targetId = state.local.has(desired) || state.trail.has(desired) ? desired : steps[index].activeId
    viewer.changeTheme(mind.theme, false)
    viewer.refresh({ nodeData: tree, arrows: data.arrows, summaries: data.summaries })
    render()
  }
  function finishEdit() {
    const current = editing
    if (!current) return
    editing = undefined
    const topic = current.field.value
    current.field.remove()
    try { if (topic !== current.original) editTopic(current.id, topic) }
    catch (error) { report(error instanceof Error ? error.message : 'No se pudo editar el nodo.') }
    if (deferredSync) { const pending = deferredSync; deferredSync = undefined; pending() }
    else sync()
    for (const resolve of editWaiters) resolve()
    editWaiters.clear()
    if (viewer) viewer.container.focus({ preventScroll: true })
  }
  function beginEdit() {
    if (!viewer || editing || !mind.editable) return
    const node = nodePath(mind.getData().nodeData, targetId).at(-1)
    if (!node) return
    revision++
    animation?.cancel()
    const topic = viewer.findEle(targetId)
    const field = document.createElement('textarea')
    field.id = 'walk-node-editor'
    field.setAttribute('aria-label', 'Editar nodo del recorrido')
    field.value = node.topic
    field.style.width = `${Math.min(600, Math.max(240, topic.offsetWidth))}px`
    field.style.height = `${Math.min(320, Math.max(90, topic.offsetHeight))}px`
    editing = { field, id: node.id, original: node.topic }
    topic.replaceChildren(field)
    field.addEventListener('blur', finishEdit)
    field.addEventListener('keydown', event => {
      if (event.isComposing || event.keyCode === 229) return
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finishEdit() }
    })
    field.focus(); field.select()
    viewer.linkDiv()
  }
  function stop() {
    if (!viewer) return
    host.dispatchEvent(new Event('walk-stop'))
    finishEdit()
    revision++
    cancelAnimationFrame(frame); animation?.cancel()
    viewer.destroy(); viewer = undefined
    host.hidden = true
    element('map').hidden = false
    // Layout measured while this canvas was hidden has zero-sized connections.
    // Redraw once it is visible, preserving styles, zoom and translation.
    mind.linkDiv()
    element('walk-status').textContent = ''
    element('editor').classList.remove('walking')
    button.setAttribute('aria-pressed', 'false')
    for (const [control, value] of disabled) control.disabled = value
    disabled.clear()
    for (const id of ['undo', 'redo']) (element(id) as HTMLButtonElement).disabled = id === 'undo' ? !mind.historyStack!.canUndo : !mind.historyStack!.canRedo
    element('global-panel').inert = element('map').inert
    element('node-panel').inert = element('map').inert
    mind.container.focus({ preventScroll: true })
  }
  function toggle() {
    if (viewer) { stop(); return }
    if (!available()) return
    const data = source()
    tree = data.nodeData; steps = walkSteps(tree); index = 0; cameraDepth = 0; targetId = steps[0].activeId; revision++
    host.style.setProperty('--map-font', element('map').style.getPropertyValue('--map-font'))
    element('map').hidden = true; host.hidden = false
    viewer = new MindElixir({ el: host, editable: false, keypress: false, contextMenu: false, toolBar: false,
      allowUndo: false, direction: mind.direction, compact: mind.compact, theme: mind.theme, markdown: renderMarkdown, scaleMin: .05, scaleMax: 5 })
    const current = viewer
    viewer.bus.addListener('linkDiv', labelEdges)
    void viewer.init({ nodeData: tree, arrows: data.arrows, summaries: data.summaries }).then(() => { if (viewer === current) render() })
    element('editor').classList.add('walking'); button.setAttribute('aria-pressed', 'true')
    for (const id of ['layout-left', 'layout-right', 'layout-side', 'outline-button', 'search-button']) {
      const control = element(id) as HTMLButtonElement
      disabled.set(control, control.disabled); control.disabled = true
    }
    element('search-panel').hidden = true; element('search-button').setAttribute('aria-expanded', 'false')
    element('global-panel').inert = true; element('node-panel').inert = true
    viewer.container.focus({ preventScroll: true })
    host.dispatchEvent(new Event('walk-start'))
  }
  function advance(delta: number) {
    const next = Math.max(0, Math.min(steps.length - 1, index + delta))
    if (next !== index) { index = next; targetId = steps[index].activeId; revision++; render() }
  }
  function changeFrame(delta: number) {
    const camera = walkFrame(tree, steps[index], cameraDepth + delta, false)
    if (camera.depth !== cameraDepth) { cameraDepth = camera.depth; render() }
  }
  function pick(event: MouseEvent) {
    if (!viewer || editing) return false
    const node = (event.target as Element).closest<HTMLElement & { nodeObj: NodeObj }>('.me-tpc')
    if (!node || !(node.classList.contains('walk-local') || node.classList.contains('walk-trail'))) return false
    targetId = node.nodeObj.id; revision++; highlight(); host.dataset.target = targetId
    return true
  }
  host.addEventListener('click', event => { if (pick(event)) { event.stopImmediatePropagation(); viewer?.container.focus({ preventScroll: true }) } }, true)
  host.addEventListener('dblclick', event => { if (pick(event)) { event.preventDefault(); event.stopImmediatePropagation(); beginEdit() } }, true)
  button.addEventListener('click', toggle)
  const observer = new ResizeObserver(() => { if (viewer) { cancelAnimationFrame(frame); frame = requestAnimationFrame(fit) } })
  observer.observe(host)
  new MutationObserver(() => {
    if (viewer) { cancelAnimationFrame(frame); frame = requestAnimationFrame(fit) }
  }).observe(element('ai-composer'), { attributes: true, attributeFilter: ['hidden'] })
  return { toggle, stop, fit, sync, finishEdit, beginEdit,
    get active() { return !!viewer }, get canvas() { return viewer ?? mind }, get targetId() { return targetId }, get revision() { return revision }, get editing() { return !!editing },
    context: () => branchContext(mind.getData().nodeData, steps[index], targetId),
    waitForEdit(signal: AbortSignal) {
      if (!editing) return Promise.resolve()
      return new Promise<void>((resolve, reject) => {
        const done = () => { signal.removeEventListener('abort', abort); editWaiters.delete(done); resolve() }
        const abort = () => { editWaiters.delete(done); reject(new DOMException('Cancelado', 'AbortError')) }
        editWaiters.add(done); signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
      })
    },
    key(event: KeyboardEvent) {
      if (!viewer || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false
      if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Escape', 'F2'].includes(event.key)) return false
      if (event.key === 'Escape') stop()
      else if (event.key === 'F2') beginEdit()
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') changeFrame(event.key === 'ArrowRight' ? 1 : -1)
      else advance(event.key === 'ArrowDown' ? 1 : -1)
      return true
    } }
}
export type Navigation = ReturnType<typeof installNavigation>
