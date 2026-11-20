import MindElixir from '../src/index'
import { es } from '../src/i18n'
import { downloadImage } from '@mind-elixir/export-mindmap'
import type { MindElixirData } from '../src/types/index'
import { applyProposal, parseProposal, type Action, type Proposal } from './ai'
import { exampleMap, loadMap, saveMap, validateMap } from './data'
import './style.css'

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
let toastTimer: ReturnType<typeof setTimeout>
function message(text: string, error = false) {
  $('message').textContent = text
  $('message').classList.toggle('error', error)
  $('message').hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { $('message').hidden = true }, error ? 12_000 : 5000)
}
function run(fn: () => unknown | Promise<unknown>) {
  return () => { Promise.resolve().then(fn).catch(e => message(e instanceof Error ? e.message : 'No se pudo completar la acción.', true)) }
}

const mind = new MindElixir({
  el: '#map', newTopicName: 'Nuevo concepto',
  contextMenu: { locale: es, focus: false, link: true },
  // Editing, drag-and-drop, selection and undo come directly from upstream.
  toolBar: false, keypress: true, allowUndo: true, theme: MindElixir.THEME,
})
let initial = exampleMap()
let corruptStoredData = false
try { initial = loadMap(localStorage) ?? initial } catch {
  corruptStoredData = true
  message('No se pudo recuperar el guardado anterior. No se sobrescribirá hasta que edites o importes un mapa.', true)
}
const initError = await mind.init(initial)
if (initError) throw initError
mind.scaleFit()

function persist() {
  if (corruptStoredData) return
  try {
    saveMap(localStorage, mind.getData())
    $('save-status').textContent = 'Guardado en este navegador'
  } catch { $('save-status').textContent = 'No se pudo guardar. Exportá una copia JSON.' }
}
if (!corruptStoredData) persist()
const note = $<HTMLTextAreaElement>('node-note')
let selectedId = ''
let selectionRevision = 0
function selection() {
  const node = mind.currentNode?.nodeObj
  selectedId = node?.id ?? ''
  $('selected-topic').textContent = node?.topic ?? 'Seleccioná un concepto del mapa'
  note.disabled = !node
  note.value = node?.note ?? ''
}
mind.bus.addListener('selectNodes', selection)
mind.bus.addListener('unselectNodes', () => { queueMicrotask(selection) })
mind.bus.addListener('operation', () => { corruptStoredData = false; selectionRevision++; queueMicrotask(() => { persist(); selection() }) })
mind.bus.addListener('changeDirection', () => { corruptStoredData = false; persist() })
note.addEventListener('change', run(async () => {
  const node = mind.currentNode
  if (node && node.nodeObj.id === selectedId) await mind.reshapeNode(node, { note: note.value })
}))
mind.historyStack?.register('app', (entry, direction) => {
  mind.refresh(structuredClone(direction === 'undo' ? entry.before : entry.after))
  selectionRevision++
  selection()
  persist()
})
mind.historyStack?.subscribe(() => {
  $<HTMLButtonElement>('undo').disabled = !mind.historyStack?.canUndo
  $<HTMLButtonElement>('redo').disabled = !mind.historyStack?.canRedo
  persist()
  selection()
})
function replace(data: MindElixirData, record = true) {
  const before = mind.getData()
  mind.refresh(data)
  corruptStoredData = false
  if (record) mind.historyStack?.push('app', before, mind.getData())
  else mind.clearHistory?.()
  mind.scaleFit()
  mind.toCenter()
  selectionRevision++
  selection()
  persist()
}
function current() {
  if (!mind.currentNode) throw new Error('Primero seleccioná un concepto del mapa.')
  return mind.currentNode
}
const handlers: Record<string, () => unknown | Promise<unknown>> = {
  'add-child': () => mind.addChild(mind.currentNode ?? mind.findEle(mind.nodeData.id)),
  'add-sibling': () => mind.insertSibling('after', current()),
  'remove-node': () => { const node = current(); if (node.nodeObj.id === mind.nodeData.id) throw new Error('Para empezar de nuevo, usá Nuevo mapa.'); return mind.removeNodes([node]) },
  fold: () => mind.expandNode(current()),
  undo: () => mind.undo(), redo: () => mind.redo(),
  center: () => { mind.scaleFit(); mind.toCenter() },
  'zoom-in': () => mind.scale(mind.scaleVal + 0.1), 'zoom-out': () => mind.scale(mind.scaleVal - 0.1),
  'new-map': () => {
    if (confirm('¿Empezar un mapa nuevo? Podés deshacer esta acción. Exportá JSON si querés conservar una copia aparte.')) {
      invalidateProposal()
      replace(MindElixir.new('Nuevo tema'))
    }
  },
  'export-map': () => {
    const url = URL.createObjectURL(new Blob([mind.getDataString()], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = 'mi-mapa.json'; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  },
  'export-png': async () => { await downloadImage(mind, 'png'); message('Imagen exportada.') },
  'import-map': () => $<HTMLInputElement>('file-input').click(),
  help: () => $<HTMLDialogElement>('help-dialog').showModal(),
  'close-help': () => $<HTMLDialogElement>('help-dialog').close(),
}
for (const [id, handler] of Object.entries(handlers)) $(id).addEventListener('click', run(handler))
$<HTMLInputElement>('file-input').addEventListener('change', run(async () => {
  const input = $<HTMLInputElement>('file-input')
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const data = validateMap(JSON.parse(await file.text()))
  invalidateProposal()
  replace(data)
  message('Mapa importado. Podés deshacer para volver al anterior.')
}))

let requestVersion = 0
let pending: { proposal: Proposal; action: Action; targetId: string; revision: number } | null = null
function invalidateProposal() { requestVersion++; pending = null; $('proposal').hidden = true }
$('discard-ai').addEventListener('click', invalidateProposal)
$('ai-form').addEventListener('submit', event => {
  event.preventDefault()
  void ask().catch(e => message(e instanceof Error ? e.message : 'No se pudo consultar a Groq.', true))
})
async function ask() {
  const action = $<HTMLSelectElement>('ai-action').value as Action
  const text = $<HTMLTextAreaElement>('ai-text').value.trim()
  if (!text) throw new Error('Escribí un tema o una pregunta.')
  const node = action === 'generate' ? null : current().nodeObj
  const targetId = node?.id ?? mind.nodeData.id
  const revision = selectionRevision
  invalidateProposal()
  const version = requestVersion
  const button = $<HTMLButtonElement>('ask-ai')
  button.disabled = true; button.textContent = 'Preparando propuesta…'
  try {
    const response = await fetch('/api/ai', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(55_000),
      body: JSON.stringify({ action, text, context: node ? JSON.stringify({ topic: node.topic, note: node.note ?? '' }) : '' }),
    })
    const payload = await response.json().catch(() => { throw new Error('El servidor no devolvió JSON. Revisá el despliegue de /api/ai en Vercel.') })
    if (!response.ok) throw new Error(payload.error ?? 'Groq no pudo responder.')
    if (version !== requestVersion) return
    const proposal = parseProposal(payload)
    pending = { proposal, action, targetId, revision }
    $('proposal-summary').textContent = proposal.summary
    const list = $('proposal-nodes'); list.replaceChildren()
    for (const n of proposal.nodes) {
      const item = document.createElement('li')
      const title = document.createElement('strong'); title.textContent = n.topic
      const detail = document.createElement('p'); detail.textContent = [n.relation, n.note].filter(Boolean).join(' · ')
      item.append(title, detail); list.append(item)
    }
    $('proposal-effect').textContent = action === 'generate' ? 'Al aplicar se reemplazará el mapa actual. Podés deshacer.' : `Se agregarán conceptos a «${node!.topic}». Podés deshacer.`
    $('proposal').hidden = false
    message('Propuesta lista. Revisala antes de aplicarla.')
  } finally { button.disabled = false; button.textContent = 'Explorar con Groq ✦' }
}
$('apply-ai').addEventListener('click', run(() => {
  if (!pending) return
  if (pending.action === 'generate' && pending.revision !== selectionRevision && !confirm('Editaste el mapa desde que pediste esta propuesta. ¿Querés reemplazarlo? Podés deshacer.')) return
  const { proposal, action, targetId } = pending
  const data = applyProposal(mind.getData(), proposal, action, targetId)
  invalidateProposal()
  replace(data)
  message('Propuesta aplicada. Podés deshacerla.')
}))
window.addEventListener('pagehide', persist)
