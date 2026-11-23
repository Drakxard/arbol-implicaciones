import MindElixir from 'mind-elixir'
import { renderMarkdown } from './markdown'
import { walkSteps, walkTree, type WalkStep } from './walk'

export function installNavigation(mind: MindElixir, available: () => boolean) {
  const element = (id: string) => document.getElementById(id)!
  const host = element('walk-map')
  const button = element('walk-button')
  const focusButton = element('walk-focus')
  let viewer: MindElixir | undefined
  let steps: WalkStep[] = []
  let index = 0
  let focus = false
  let frame = 0
  const disabled = new Map<HTMLButtonElement, boolean>()

  function fit() {
    if (!viewer) return
    // Fit the visible frontier, keeping room for the rail and navigation controls.
    const bounds = host.getBoundingClientRect()
    viewer.scale(1)
    const nodes = Array.from(viewer.container.querySelectorAll<HTMLElement>('.me-tpc'))
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
  }

  function render() {
    if (!viewer) return
    const step = steps[index]
    viewer.refresh({ nodeData: walkTree(step, focus) })
    viewer.selectNode(viewer.findEle(step.activeId))
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
    function preserve(node: typeof data.nodeData) {
      const original = mind.findEle(node.id)
      if (original) {
        const css = getComputedStyle(original)
        node.style = { ...node.style, color: css.color, fontSize: css.fontSize, background: css.backgroundColor }
      }
      node.children?.forEach(preserve)
    }
    preserve(data.nodeData)
    steps = walkSteps(data.nodeData)
    index = 0
    host.style.setProperty('--map-font', element('map').style.getPropertyValue('--map-font'))
    element('map').hidden = true
    host.hidden = false
    viewer = new MindElixir({ el: host, editable: false, keypress: false, contextMenu: false, toolBar: false,
      allowUndo: false, direction: mind.direction, compact: mind.compact, theme: mind.theme,
      markdown: renderMarkdown, scaleMin: .05, scaleMax: 5 })
    const currentViewer = viewer
    void viewer.init({ nodeData: walkTree(steps[0], focus) }).then(() => {
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
    render()
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
