import type { MindElixirData } from 'mind-elixir'
import type { Navigation } from './navigation'
import { appendBranch, nodePath } from './ai-context'
import { groqRequest, readGroqSettings } from './groq-settings'
import { validateBranch } from '../shared/groq'
import { listEdit, listNewline } from './composer'

export function installAI(navigation: Navigation, snapshot: () => MindElixirData,
  apply: (data: MindElixirData, preferredLeaf?: string) => void, report: (message: string) => void) {
  const host = document.getElementById('walk-map')!
  const composer = document.getElementById('ai-composer')!
  const field = document.getElementById('ai-prompt') as HTMLTextAreaElement
  let request: AbortController | undefined
  let epoch = 0
  function enabled() { const settings = readGroqSettings(); return settings.enabled && !!settings.credential }
  function resize() {
    field.style.height = '0px'
    field.style.height = `${Math.min(100, Math.max(25, field.scrollHeight))}px`
  }
  function open(text?: string) {
    composer.hidden = false
    if (text !== undefined) field.value += text
    resize(); field.focus({ preventScroll: true }); field.setSelectionRange(field.value.length, field.value.length)
  }
  function blur() { field.blur(); if (navigation.active) navigation.canvas.container.focus({ preventScroll: true }) }
  function cancel() { epoch++; request?.abort(); request = undefined; composer.removeAttribute('aria-busy') }
  host.addEventListener('walk-stop', () => { cancel(); composer.hidden = true })
  document.addEventListener('groq-settings-change', () => { cancel(); if (!enabled()) composer.hidden = true })
  field.addEventListener('input', resize)
  function edit(range: { from: number; to: number; text: string }) {
    field.setRangeText(range.text, range.from, range.to, 'end')
    field.dispatchEvent(new Event('input', { bubbles: true }))
  }
  for (const [id, ordered] of [['ai-bullets', false], ['ai-numbers', true]] as const) {
    const button = document.getElementById(id)!
    button.addEventListener('pointerdown', event => event.preventDefault())
    button.addEventListener('click', () => { field.focus(); edit(listEdit(field.value, field.selectionStart, field.selectionEnd, ordered)) })
  }
  async function submit() {
    if (request || !enabled() || !navigation.active || !field.value.trim()) return
    const instruction = field.value
    const current = new AbortController()
    request = current
    const generation = epoch
    const position = navigation.revision
    composer.setAttribute('aria-busy', 'true')
    try {
      const context = navigation.context()
      const target = nodePath(snapshot().nodeData, context.target.id).at(-1)!
      const fingerprint = JSON.stringify(target)
      const response = await groqRequest('branch', { credential: readGroqSettings().credential, context, instruction },
        AbortSignal.any([current.signal, AbortSignal.timeout(55000)]))
      const branch = validateBranch(response)
      await navigation.waitForEdit(current.signal)
      if (current.signal.aborted || generation !== epoch || !navigation.active) return
      const data = snapshot()
      const now = nodePath(data.nodeData, context.target.id).at(-1)
      if (!now || JSON.stringify(now) !== fingerprint) throw new Error('El nodo cambió durante el pedido. Enviá nuevamente la instrucción.')
      const result = appendBranch(data.nodeData, context.target.id, branch)
      data.nodeData = result.root
      const follow = position === navigation.revision && (document.activeElement !== field || field.value === instruction)
      apply(data, follow ? result.firstLeafId : undefined)
      if (field.value === instruction) { field.value = ''; composer.hidden = true; blur() }
      resize()
    } catch (error) {
      if (!current.signal.aborted && generation === epoch) {
        report(error instanceof Error ? error.message : 'No se pudo generar la rama.')
        composer.hidden = false; resize()
      }
    } finally {
      if (request === current) { request = undefined; composer.removeAttribute('aria-busy') }
    }
  }
  return { reset() { cancel(); field.value = ''; composer.hidden = true },
    key(event: KeyboardEvent) {
      const target = event.target as HTMLElement
      if (!navigation.active || !enabled() || target.closest('#walk-node-editor')) return false
      if (target === field) {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { void submit(); return true }
        if (event.key === 'Escape') { blur(); return true }
        if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.altKey) { edit(listNewline(field.value, field.selectionStart, field.selectionEnd)); return true }
        return false
      }
      if (target.closest('input, textarea, select, [contenteditable]:not([contenteditable=false]), button, dialog')) return false
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !composer.hidden) { void submit(); return true }
      if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1 && event.key !== '*') { open(event.key); return true }
      return false
    } }
}
