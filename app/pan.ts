import type MindElixir from 'mind-elixir'

export function installCanvasPan(mind: MindElixir, button: HTMLButtonElement, finishEdit: () => void) {
  const surface = mind.container
  let hand = false
  let drag: { pointerId: number; x: number; y: number } | null = null
  let suppressClick = false

  function stopDrag() {
    if (!drag) return
    const { pointerId } = drag
    drag = null
    surface.classList.remove('panning')
    if (surface.hasPointerCapture(pointerId)) surface.releasePointerCapture(pointerId)
  }

  button.addEventListener('click', () => {
    stopDrag()
    hand = !hand
    surface.classList.toggle('hand-mode', hand)
    button.setAttribute('aria-pressed', String(hand))
  })

  // Capture before Core starts selecting or dragging a node.
  surface.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'mouse' || drag || !(event.button === 1 || (hand && event.button === 0))) return
    event.preventDefault()
    event.stopImmediatePropagation()
    finishEdit()
    surface.focus({ preventScroll: true })
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
    surface.classList.add('panning')
    surface.setPointerCapture(event.pointerId)
  }, true)

  surface.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return
    event.preventDefault()
    event.stopImmediatePropagation()
    mind.move(event.clientX - drag.x, event.clientY - drag.y)
    drag.x = event.clientX
    drag.y = event.clientY
  }, true)

  const end = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return
    event.preventDefault()
    event.stopImmediatePropagation()
    suppressClick = true
    stopDrag()
    setTimeout(() => { suppressClick = false }, 0)
  }
  surface.addEventListener('pointerup', end, true)
  surface.addEventListener('pointercancel', end, true)
  surface.addEventListener('lostpointercapture', stopDrag)
  window.addEventListener('blur', stopDrag)
  surface.addEventListener('click', event => {
    if (!hand && !suppressClick) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }, true)
  // Suppress the browser's middle-button autoscroll and link opening.
  surface.addEventListener('auxclick', event => {
    if (event.button !== 1) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }, true)
}
