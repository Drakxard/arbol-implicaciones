import MindElixir, { Outliner, type MindElixirData, type NodeObj, type Theme, type MainLineParams, type SubLineParams } from 'mind-elixir'
import { es } from 'mind-elixir/i18n'
import { defaultSettings, newDocument, settingsFrom, safeLink, safeImage, type EditorSettings } from './document'
import { BrowserDirectory, FolderSession, rememberDirectory, rememberedDirectory, type WritableDirectoryHandle, type SaveState, listMaps, mapFileName, type LibraryEntry } from './storage'
import { renderApp, emojis } from './view'
import { mapPreview, moveMap } from './library'
import { icon } from './icons'
import { renderMarkdown } from './markdown'
import { installCanvasPan } from './pan'
import './style.css'

renderApp()
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const field = (id: string) => $<HTMLInputElement>(id)
const folderDialog = $<HTMLDialogElement>('folder-dialog')
let settings = defaultSettings()
let loading = true
let outline: Outliner | undefined
let selectedId = ''
let tab = 'general'
let imageRatioLocked = true
let selectingFolder = false
let toastTimer: ReturnType<typeof setTimeout>

function toast(text: string) {
  $('toast').textContent = text
  $('toast').hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { $('toast').hidden = true }, 6000)
}
function run(action: () => unknown | Promise<unknown>) {
  return () => { Promise.resolve().then(action).catch(error => toast(error instanceof Error ? error.message : 'No se pudo completar la acción.')) }
}
function on(id: string, action: () => unknown | Promise<unknown>, event = 'click') { $(id).addEventListener(event, run(action)) }

const mind = new MindElixir({ el: '#map', toolBar: false, keypress: true, allowUndo: true,
  newTopicName: 'Nuevo tema', markdown: renderMarkdown,
  contextMenu: { locale: es, focus: false, link: true }, theme: MindElixir.THEME })
const initError = await mind.init(newDocument())
if (initError) throw initError
installCanvasPan(mind, $<HTMLButtonElement>('hand'), finishMapEdit)

function finishMapEdit() {
  // Close the live editor before history removes or replaces its host node.
  for (const editor of mind.container.querySelectorAll<HTMLElement>('#input-box')) {
    editor.blur()
    // A formerly focused editor may still be mounted; run Core's commit/cleanup.
    if (editor.isConnected) editor.dispatchEvent(new FocusEvent('blur'))
  }
}

function changeHistory(redo = false) {
  finishMapEdit()
  if (redo) mind.redo(); else mind.undo()
  if ($('outline').hidden) mind.container.focus({ preventScroll: true })
}

function snapshot(): MindElixirData {
  const data = mind.getData()
  data.meta = { ...data.meta, editor: { ...settings } }
  // Theme generators are functions; store their identifiers in meta.editor instead.
  if (data.theme) {
    const { generateMainBranch: _main, generateSubBranch: _sub, ...serializable } = data.theme
    data.theme = serializable
  }
  return data
}

async function loadDocument(data: MindElixirData) {
  loading = true
  try {
    if (!$('library').hidden) showEditor()
    settings = settingsFrom(data)
    mind.clearSelection()
    selectedId = ''
    await mind.refresh(data)
    mind.meta = data.meta
    mind.changeCompact(data.compact ?? false)
    applyAppearance()
    mind.clearHistory?.()
    selectedId = ''
    refreshInspector()
    mind.scale(1)
    mind.toCenter()
    updateSearch()
  } finally { loading = false }
}

const session = new FolderSession(snapshot, loadDocument, updateSaveState)
function updateSaveState(state: SaveState, detail: string) {
  $('editor').dataset.saveState = state
  // Never allow editing a placeholder for a remembered file we could not read.
  const blocked = state === 'loading' || (!!session.directory && !session.hasLoadedDirectory)
  if (blocked) mind.disableEdit(); else mind.enableEdit()
  for (const id of ['map', 'outline', 'global-panel', 'node-panel']) $(id).inert = blocked
  const needsAction = ['permission', 'error', 'invalid', 'disconnected'].includes(state)
  $('connection-banner').hidden = !needsAction || folderDialog.open
  $('library-error').hidden = !needsAction || folderDialog.open
  $('library-error').textContent = detail || 'Seleccioná una carpeta para guardar tus cambios.'
  $('connection-message').textContent = detail || 'Seleccioná una carpeta para guardar tus cambios.'
  $('connect-banner').textContent = session.directory && state !== 'invalid' ? 'Reconectar carpeta' : 'Seleccionar carpeta'
}

function markChanged() {
  if (loading) return
  settings.updatedAt = new Date().toISOString()
  updateDates()
  session.changed()
}

function branchPath(params: MainLineParams | SubLineParams) {
  const { pL, pT, pW, pH, cL, cT, cW, cH, direction } = params
  const left = direction === 'lhs'
  const down = direction === 'down'
  const x1 = down ? pL + pW / 2 : left ? pL : pL + pW
  const y1 = down ? pT + pH : pT + pH / 2
  const x2 = down ? cL + cW / 2 : left ? cL + cW : cL
  const y2 = down ? cT : cT + cH / 2
  if (settings.branchStyle === 'straight') return `M ${x1} ${y1} L ${x2} ${y2}`
  return down ? `M ${x1} ${y1} V ${(y1 + y2) / 2} H ${x2} V ${y2}` : `M ${x1} ${y1} H ${(x1 + x2) / 2} V ${y2} H ${x2}`
}

function applyAppearance() {
  const base = settings.theme === 'Oscuro' ? MindElixir.DARK_THEME : MindElixir.THEME
  const theme: Theme = { ...base, name: settings.theme, palette: [...base.palette], cssVar: { ...base.cssVar } }
  if (settings.theme === 'Claro') theme.cssVar!['--bgcolor'] = '#ffffff'
  // Keep unstyled descendants as readable as the main branch labels.
  theme.cssVar!['--color'] = theme.cssVar!['--main-color']
  if (settings.textColor) {
    theme.cssVar!['--root-color'] = settings.textColor
    theme.cssVar!['--main-color'] = settings.textColor
    theme.cssVar!['--color'] = settings.textColor
  }
  if (settings.branchStyle !== 'curve') { theme.generateMainBranch = branchPath; theme.generateSubBranch = branchPath }
  const id = selectedId
  mind.changeTheme(theme)
  $('stage').style.setProperty('--surface', theme.cssVar!['--bgcolor']!)
  $('map').style.setProperty('--map-font', settings.fontFamily === 'monospace' ? 'monospace' : `"${settings.fontFamily.replace(/["\\]/g, '')}", serif`)
  $('outline').classList.toggle('dark', settings.theme === 'Oscuro')
  if (id) {
    const element = mind.findEle(id)
    if (element) mind.selectNode(element)
  }
}

mind.historyStack!.register('appearance', (entry, direction) => {
  const state = structuredClone(direction === 'undo' ? entry.before : entry.after)
  settings = state.settings
  mind.changeCompact(state.compact)
  applyAppearance()
  refreshInspector()
})
function changeAppearance(change: () => void) {
  const before = { settings: { ...settings }, compact: mind.compact }
  change()
  applyAppearance()
  const after = { settings: { ...settings }, compact: mind.compact }
  mind.historyStack!.push('appearance', before, after)
  refreshInspector()
}

mind.bus.addListener('operation', operation => {
  if (operation.name === 'beginEdit') return
  if (operation.name === 'finishEdit' && operation.origin === operation.target.topic) return
  markChanged()
  queueMicrotask(() => { refreshInspector(); updateSearch() })
})
mind.bus.addListener('changeDirection', () => { markChanged(); updateLayoutButtons() })
mind.bus.addListener('selectNodes', () => { refreshInspector() })
mind.bus.addListener('unselectNodes', () => { queueMicrotask(refreshInspector) })
mind.historyStack!.subscribe(() => {
  $<HTMLButtonElement>('undo').disabled = !mind.historyStack!.canUndo
  $<HTMLButtonElement>('redo').disabled = !mind.historyStack!.canRedo
  markChanged()
  queueMicrotask(() => { refreshInspector(); updateSearch() })
})

function setValue(id: string, value: string) {
  // Do not replace a focused text field while its edit is still in progress.
  if (document.activeElement !== $(id)) field(id).value = value
}
function setColor(id: string, value: string | undefined, fallback: string) {
  field(id).value = value && /^#[a-f0-9]{6}$/i.test(value) ? value : fallback
  field(id).dataset.inherited = String(!value)
}
function updateDates() {
  const format = (value: string) => new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
  $('created-at').textContent = format(settings.createdAt)
  $('updated-at').textContent = format(settings.updatedAt)
}
function updateLayoutButtons() {
  for (const [id, direction] of [['layout-left', 0], ['layout-right', 1], ['layout-side', 2]] as const) {
    $(id).setAttribute('aria-pressed', String(mind.direction === direction))
  }
}
function inheritedTextColor(node: NodeObj): string {
  // A root's default white text belongs to its dark background, not its branches.
  // Explicit colors, including an explicit root color, do inherit.
  let ancestor: NodeObj | undefined = node
  while (ancestor) {
    if (ancestor.style?.color) return ancestor.style.color
    ancestor = ancestor.parent
  }
  const variable = node.parent ? '--main-color' : '--root-color'
  return getComputedStyle(mind.container).getPropertyValue(variable).trim() || (node.parent ? '#444446' : '#ffffff')
}
function updateInheritedTextColors() {
  for (const element of mind.container.querySelectorAll<HTMLElement & { nodeObj: NodeObj }>('.me-tpc')) {
    if (element.nodeObj?.parent) element.style.color = inheritedTextColor(element.nodeObj)
  }
}
function refreshInspector() {
  updateInheritedTextColors()
  const node = mind.currentNode?.nodeObj
  const changedSelection = selectedId !== (node?.id ?? '')
  selectedId = node?.id ?? ''
  if (changedSelection) {
    // Selection events can arrive before a queued input operation completes.
    const active = document.activeElement
    if (active instanceof HTMLElement && $('inspector').contains(active)) active.blur()
  }
  $('global-panel').hidden = !!node
  $('node-panel').hidden = !node
  field('theme').value = settings.theme
  field('branch-style').value = settings.branchStyle
  field('font-family').value = settings.fontFamily
  setValue('source', settings.source)
  field('compact').checked = mind.compact
  setColor('global-color', settings.textColor, '#ffffff')
  updateDates()
  updateLayoutButtons()
  if (!node) return
  const root = node.id === mind.nodeData.id
  setColor('node-color', node.style?.color, inheritedTextColor(node))
  setColor('node-background', node.style?.background, root ? '#4c4f69' : '#ffffff')
  field('node-font-size').value = String(parseInt(node.style?.fontSize ?? (root ? '25' : '16')))
  $('font-size-value').textContent = `${field('node-font-size').value}px`
  setValue('node-tags', (node.tags ?? []).map(tag => typeof tag === 'string' ? tag : tag.text).join(', '))
  setValue('node-url', node.hyperLink ?? '')
  setValue('node-note', node.note ?? '')
  document.querySelectorAll<HTMLButtonElement>('[data-emoji]').forEach(button => {
    button.setAttribute('aria-pressed', String(node.icons?.includes(emojis[Number(button.dataset.emoji)]) ?? false))
  })
  setValue('image-width', node.image ? String(node.image.width) : '')
  setValue('image-height', node.image ? String(node.image.height) : '')
  setValue('image-url', node.image && !node.image.url.startsWith('data:') ? node.image.url : '')
  field('image-fit').value = node.image?.fit ?? 'contain'
  $<HTMLButtonElement>('image-clear').disabled = !node.image
}

async function patchNode(patch: Partial<NodeObj>, id = selectedId) {
  if (!id) return
  const element = mind.findEle(id)
  if (element) await mind.reshapeNode(element, patch)
}
function nodeTextChange(id: string, patch: (value: string) => Partial<NodeObj>) {
  // Capture the target at input time, before the user can select another node.
  $(id).addEventListener('input', () => {
    const target = selectedId
    try { void patchNode(patch(field(id).value), target).catch(error => toast(error.message)) }
    catch (error) { toast((error as Error).message) }
  })
}

on('theme', () => changeAppearance(() => { settings.theme = field('theme').value as EditorSettings['theme'] }), 'change')
on('branch-style', () => changeAppearance(() => { settings.branchStyle = field('branch-style').value as EditorSettings['branchStyle'] }), 'change')
on('font-family', () => changeAppearance(() => { settings.fontFamily = field('font-family').value }), 'change')
on('compact', () => changeAppearance(() => { mind.changeCompact(field('compact').checked) }), 'change')
on('global-color', () => changeAppearance(() => { settings.textColor = field('global-color').value }), 'change')
on('global-color-clear', () => changeAppearance(() => { settings.textColor = '' }))
on('source', () => changeAppearance(() => { settings.source = field('source').value }), 'change')
for (const [id, property] of [['node-color', 'color'], ['node-background', 'background']] as const) {
  on(id, () => patchNode({ style: { [property]: field(id).value } }), 'change')
  on(`${id}-clear`, () => patchNode({ style: { [property]: '' } }))
}
nodeTextChange('node-tags', value => ({ tags: value.split(',').map(tag => tag.trim()).filter(Boolean) }))
nodeTextChange('node-note', value => ({ note: value }))
on('node-url', async () => {
  const value = field('node-url').value.trim()
  if (value && !safeLink(value)) { toast('El enlace debe comenzar con http:// o https://.'); refreshInspector(); return }
  await patchNode({ hyperLink: value })
}, 'change')
field('node-font-size').addEventListener('input', () => { $('font-size-value').textContent = `${field('node-font-size').value}px` })
on('node-font-size', () => patchNode({ style: { fontSize: field('node-font-size').value + 'px' } }), 'change')
document.querySelectorAll<HTMLButtonElement>('[data-emoji]').forEach(button => button.addEventListener('click', run(async () => {
  const emoji = emojis[Number(button.dataset.emoji)]
  const icons = mind.currentNode?.nodeObj.icons ?? []
  await patchNode({ icons: icons.includes(emoji) ? icons.filter(value => value !== emoji) : [...icons, emoji] })
})))

for (const name of ['general', 'image', 'note']) {
  on(`tab-${name}`, () => activateTab(name))
  $(`tab-${name}`).addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault()
    const tabs = ['general', 'image', 'note']
    activateTab(tabs[(tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : 2)) % 3])
    $(`tab-${tab}`).focus()
  })
}
function activateTab(name: string) {
  tab = name
  for (const candidate of ['general', 'image', 'note']) {
    $(`tab-${candidate}`).setAttribute('aria-selected', String(candidate === name))
    $(`tab-${candidate}`).tabIndex = candidate === name ? 0 : -1
    $(`panel-${candidate}`).hidden = candidate !== name
  }
}
activateTab('general')

on('image-type', () => {
  $('image-local-field').hidden = field('image-type').value !== 'local'
  $('image-url-field').hidden = field('image-type').value !== 'url'
}, 'change')
on('image-upload', () => field('image-file').click())
on('image-file', async () => {
  const id = selectedId
  const file = field('image-file').files?.[0]
  field('image-file').value = ''
  if (!file) return
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) throw new Error('Elegí una imagen PNG, JPEG, GIF o WebP.')
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'))
    reader.readAsDataURL(file)
  })
  await applyImage(url, id)
}, 'change')
let imageRequest = 0
async function applyImage(url: string, id: string) {
  if (!safeImage(url)) throw new Error('Usá una URL http/https o una imagen local compatible.')
  const request = ++imageRequest
  const image = new Image()
  image.src = url
  await image.decode().catch(() => { throw new Error('No se pudo cargar la imagen. Revisá su dirección o formato.') })
  if (request !== imageRequest) return
  const scale = Math.min(1, 240 / image.naturalWidth, 200 / image.naturalHeight)
  await patchNode({ image: { url, width: Math.max(1, Math.round(image.naturalWidth * scale)), height: Math.max(1, Math.round(image.naturalHeight * scale)), fit: 'contain' } }, id)
}
on('image-url-apply', () => applyImage(field('image-url').value.trim(), selectedId))
on('image-ratio', () => { imageRatioLocked = !imageRatioLocked; $('image-ratio').setAttribute('aria-pressed', String(imageRatioLocked)) })
for (const dimension of ['width', 'height'] as const) on(`image-${dimension}`, async () => {
  const image = mind.currentNode?.nodeObj.image
  if (!image) return
  const value = Number(field(`image-${dimension}`).value)
  if (!Number.isFinite(value) || value < 1 || value > 4000) { toast('La dimensión debe estar entre 1 y 4000 píxeles.'); refreshInspector(); return }
  const next = { ...image, [dimension]: value }
  if (imageRatioLocked) {
    if (dimension === 'width') next.height = Math.max(1, Math.round(value * image.height / image.width))
    else next.width = Math.max(1, Math.round(value * image.width / image.height))
  }
  await patchNode({ image: next })
}, 'change')
on('image-fit', () => {
  const image = mind.currentNode?.nodeObj.image
  if (image) return patchNode({ image: { ...image, fit: field('image-fit').value as 'contain' | 'cover' | 'fill' } })
}, 'change')
on('image-clear', () => { imageRequest++; return patchNode({ image: undefined }) })

on('collapse-panel', () => {
  const collapsed = $('inspector').classList.toggle('collapsed')
  $('collapse-panel').setAttribute('aria-expanded', String(!collapsed))
  $('collapse-panel').setAttribute('aria-label', collapsed ? 'Expandir panel' : 'Contraer panel')
})
new ResizeObserver(() => { if (!loading && $('outline').hidden) mind.toCenter() }).observe($('stage'))
on('center', () => mind.toCenter())
on('zoom-out', () => mind.scale(mind.scaleVal - .1))
on('zoom-in', () => mind.scale(mind.scaleVal + .1))
on('layout-right', () => mind.initRight())
on('layout-left', () => mind.initLeft())
on('layout-side', () => mind.initSide())
on('fullscreen', async () => {
  if (document.fullscreenElement) await document.exitFullscreen()
  else await $('editor').requestFullscreen()
})
on('undo', () => changeHistory())
on('redo', () => changeHistory(true))
on('outline-button', () => {
  const show = $('outline').hidden
  if (show && !outline) outline = new Outliner({ el: '#outline', mei: mind, fileName: 'Mapa mental', markdown: renderMarkdown, i18n: {
    menuTitle: 'Operaciones del nodo', outdent: 'Quitar sangría', indent: 'Añadir sangría', delete: 'Eliminar', untitled: 'Sin título', zoomInAndDrag: 'Entrar / arrastrar para mover',
  } })
  $('outline').hidden = !show
  $('map').hidden = show
  $('outline-button').setAttribute('aria-pressed', String(show))
  if (!show) { mind.toCenter(); mind.container.focus() }
})

function openSearch() {
  $('search-panel').hidden = false
  $('search-button').setAttribute('aria-expanded', 'true')
  field('search-input').focus()
  updateSearch()
}
on('search-button', openSearch)
on('search-close', () => { $('search-panel').hidden = true; $('search-button').setAttribute('aria-expanded', 'false'); mind.container.focus() })
field('search-input').addEventListener('input', updateSearch)
function updateSearch() {
  const results = $('search-results')
  results.replaceChildren()
  const query = field('search-input').value.trim().toLocaleLowerCase('es')
  if (!query) return
  const matches: NodeObj[] = []
  function visit(node: NodeObj) {
    if (node.topic.toLocaleLowerCase('es').includes(query)) matches.push(node)
    node.children?.forEach(visit)
  }
  visit(mind.nodeData)
  const count = document.createElement('p')
  count.textContent = `${matches.length} resultado${matches.length === 1 ? '' : 's'}`
  results.append(count)
  for (const node of matches) {
    const button = document.createElement('button')
    button.type = 'button'; button.textContent = node.topic
    button.addEventListener('click', run(() => {
      const ancestors: NodeObj[] = []
      let parent = node.parent
      while (parent) {
        ancestors.unshift(parent)
        parent = parent.parent
      }
      for (const ancestor of ancestors) {
        if (ancestor.expanded === false) mind.expandNode(mind.findEle(ancestor.id), true)
      }
      const element = mind.findEle(node.id)
      mind.selectNode(element)
      mind.scrollIntoView(element, true)
      if (!$('outline').hidden) $('outline-button').click()
    }))
    const item = document.createElement('div')
    item.setAttribute('role', 'listitem')
    item.append(button)
    results.append(item)
  }
}

const shortcutsDialog = $<HTMLDialogElement>('shortcuts-dialog')
function openShortcuts() { if (!shortcutsDialog.open) { shortcutsDialog.showModal(); document.querySelector('.shortcuts-scroll')!.scrollTop = 0 } }
on('shortcuts-button', openShortcuts)
on('shortcuts-close', () => shortcutsDialog.close())
on('folder-close', () => folderDialog.close())
folderDialog.addEventListener('close', () => updateSaveState(session.state, session.detail))
on('file-menu-button', showLibrary)

let libraryEntries: LibraryEntry[] = []
let inTrash = false
let libraryBusy = false
function folderHandle() { return session.directory instanceof BrowserDirectory ? session.directory.handle : null }
async function libraryDirectory() {
  const handle = folderHandle()
  if (!handle) return null
  if (!inTrash) return handle
  try { return await handle.getDirectoryHandle('.papelera') }
  catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') return null; throw error }
}
async function refreshLibrary() {
  const handle = await libraryDirectory()
  libraryEntries = handle ? await listMaps(handle) : []
  drawLibrary()
}
function drawLibrary() {
  $('library-home').setAttribute('aria-current', inTrash ? 'false' : 'page')
  $('library-trash').setAttribute('aria-current', inTrash ? 'page' : 'false')
  $('create-map').hidden = inTrash
  const query = field('library-search').value.trim().toLocaleLowerCase('es')
  const entries = libraryEntries.filter(entry => entry.data.nodeData.topic.toLocaleLowerCase('es').includes(query))
  const cards = $('library-cards')
  cards.replaceChildren()
  for (const entry of entries) {
    const card = document.createElement('article'); card.className = 'map-card'
    const open = document.createElement('button'); open.type = 'button'; open.className = 'map-card-open'
    open.setAttribute('aria-label', `${inTrash ? 'Restaurar' : 'Abrir'} ${entry.data.nodeData.topic}`)
    const preview = document.createElement('div'); preview.className = 'map-preview'; preview.append(mapPreview(entry))
    const info = document.createElement('div'); info.className = 'map-card-info'
    const title = document.createElement('div'); title.className = 'map-card-title'; title.textContent = entry.data.nodeData.topic
    const date = document.createElement('time')
    date.textContent = new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(settingsFrom(entry.data).updatedAt))
    info.append(title, date); open.append(preview, info)
    open.addEventListener('click', run(() => libraryAction(async () => {
      const handle = folderHandle()
      if (!handle) return
      if (inTrash) {
        const trash = await libraryDirectory()
        if (trash) await moveMap(trash, handle, entry.fileName)
        await refreshLibrary()
      } else if (await session.connect(new BrowserDirectory(handle, entry.fileName))) showEditor()
    })))
    card.append(open)
    if (!inTrash) {
      const menu = document.createElement('details'); menu.className = 'map-card-menu'
      const summary = document.createElement('summary'); summary.textContent = '···'; summary.setAttribute('aria-label', `Opciones de ${entry.data.nodeData.topic}`)
      const remove = document.createElement('button'); remove.type = 'button'; remove.innerHTML = `${icon('trash')} Mover a la papelera`
      remove.addEventListener('click', run(() => libraryAction(async () => {
        const handle = folderHandle()
        if (!handle) return
        const trash = await handle.getDirectoryHandle('.papelera', { create: true })
        await moveMap(handle, trash, entry.fileName)
        await refreshLibrary()
      })))
      menu.append(summary, remove); card.append(menu)
    }
    cards.append(card)
  }
  $('library-empty').hidden = entries.length > 0
  $('library-empty').textContent = query ? 'No se encontraron mapas.' : inTrash ? 'La papelera está vacía. Hacé clic en un mapa para restaurarlo.' : 'No hay mapas en esta carpeta.'
}
async function libraryAction(action: () => Promise<void>) {
  if (libraryBusy) return
  libraryBusy = true
  try { await action() }
  catch (error) { $('library-error').textContent = error instanceof Error ? error.message : 'No se pudo abrir la biblioteca.'; $('library-error').hidden = false }
  finally { libraryBusy = false }
}
function showEditor() {
  $('library').hidden = true
  $('editor').hidden = false
  requestAnimationFrame(() => { mind.toCenter(); mind.container.focus() })
}
async function showLibrary() {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  await Promise.resolve()
  await session.save()
  // Stay in the editor if saving failed, so the pending map can be recovered.
  if (session.dirty) return
  $('search-panel').hidden = true
  $('editor').hidden = true
  $('library').hidden = false
  inTrash = false
  await libraryAction(refreshLibrary)
}
on('library-search', drawLibrary, 'input')
on('library-home', () => libraryAction(async () => { inTrash = false; await refreshLibrary() }))
on('library-trash', () => libraryAction(async () => { inTrash = true; await refreshLibrary() }))
on('create-map', () => libraryAction(async () => {
  const handle = folderHandle()
  if (!handle) { if (!folderDialog.open) folderDialog.showModal(); return }
  const directory = new BrowserDirectory(handle, null)
  if (!await session.connect(directory)) return
  // A new map gets a distinct root title, which also defines its filename.
  const files = new Set((await listMaps(handle)).map(entry => entry.fileName.toLocaleLowerCase()))
  let title = 'Nuevo Mapa Mental'; let n = 2
  while (files.has(mapFileName(title).toLocaleLowerCase())) title = `Nuevo Mapa Mental ${n++}`
  const data = newDocument(); data.nodeData.topic = title
  await loadDocument(data)
  session.changed()
  await session.save()
  if (!session.dirty) showEditor()
}))

const pickDirectory = (window as unknown as { showDirectoryPicker?: (options: { mode: 'readwrite'; id: string }) => Promise<WritableDirectoryHandle> }).showDirectoryPicker?.bind(window)
// Native pickers must be called directly inside the click handler, not after async work.
async function chooseFolder() {
  if (!pickDirectory) { showUnsupported(); return }
  if (selectingFolder) return
  if (session.dirty && !confirm('Hay cambios sin guardar. Abrir otra carpeta reemplazará el mapa actual. ¿Continuar?')) return
  selectingFolder = true
  try {
    const handle = await pickDirectory({ mode: 'readwrite', id: 'arbol-map-folder' })
    const connected = await session.connect(new BrowserDirectory(handle))
    try { await rememberDirectory(handle) } catch { toast('El navegador no pudo recordar la carpeta para la próxima visita.') }
    if (connected) {
      folderDialog.close()
    } else {
      $('folder-dialog-message').textContent = session.detail
      folderDialog.close()
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      $('folder-dialog-message').textContent = 'No se seleccionó una carpeta. Podés intentarlo nuevamente.'
    } else toast(error instanceof Error ? error.message : 'No se pudo seleccionar la carpeta.')
  } finally { selectingFolder = false; if (!$('library').hidden) await refreshLibrary() }
}
function reconnectFolder() {
  if (!session.directory) return chooseFolder()
  // Invoke requestPermission synchronously while the user activation is present.
  const directory = session.directory
  const permission = directory.requestPermission()
  void permission.then(async result => {
    if (result !== 'granted') { updateSaveState('permission', 'No se concedió permiso. Reconectá la carpeta o seleccioná otra.'); return }
    await session.connect(directory, false, session.dirty)
  }).catch(error => toast(error.message))
}
function showUnsupported() {
  $('folder-title').textContent = 'Abrí el editor en Chrome o Edge'
  $('folder-dialog-message').textContent = 'El guardado en carpetas requiere Chrome o Edge de escritorio y una conexión HTTPS o localhost.'
  $<HTMLButtonElement>('folder-start').disabled = true
  if (!folderDialog.open) folderDialog.showModal()
}
// These handlers deliberately preserve native user activation.
$('folder-start').addEventListener('click', () => { void chooseFolder() })
$('choose-folder').addEventListener('click', () => { void chooseFolder() })
$('connect-banner').addEventListener('click', () => {
  if (session.directory && session.state !== 'invalid') reconnectFolder()
  else void chooseFolder()
})
async function saveNow() {
  // Commit a pending change event (source, URL, slider, dimensions) before saving.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  await Promise.resolve()
  if (session.state === 'invalid') { toast('El archivo es inválido. Seleccioná otra carpeta o corregí el archivo antes de reconectar.'); return }
  if (!session.directory) { if (!folderDialog.open) folderDialog.showModal(); return }
  if (['permission', 'error'].includes(session.state)) { reconnectFolder(); return }
  await session.save()
}

document.addEventListener('keydown', event => {
  const mod = event.ctrlKey || event.metaKey
  const key = event.key.toLowerCase()
  if (event.isComposing) return
  if (event.key === 'Escape') {
    $('search-panel').hidden = true
    $('search-button').setAttribute('aria-expanded', 'false')
  }
  if (folderDialog.open || shortcutsDialog.open) return
  if (!$('library').hidden) {
    if (mod && key === 'f') { event.preventDefault(); field('library-search').focus() }
    if (mod && key === 's') event.preventDefault()
    return
  }
  if (mod && key === 's') { event.preventDefault(); event.stopPropagation(); void saveNow(); return }
  if (mod && key === 'f') { event.preventDefault(); event.stopPropagation(); openSearch(); return }
  const target = event.target as HTMLElement
  const typing = !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable=false])')
  const editingMap = !!target.closest('#map #input-box')
  if (mod && (key === 'z' || key === 'y') && (!typing || editingMap)) {
    event.preventDefault(); event.stopPropagation()
    changeHistory(key === 'y' || event.shiftKey)
    return
  }
  if (typing) return
  if (mod && event.key === '+') { event.preventDefault(); event.stopPropagation(); mind.scale(mind.scaleVal + .1); return }
  if (event.shiftKey && (event.key === '?' || event.code === 'Slash')) { event.preventDefault(); event.stopPropagation(); openShortcuts(); return }
  // Map shortcuts on the background; Tab on buttons keeps normal focus navigation.
  if (target === document.body && $('outline').hidden && (['Tab', 'Enter', 'Delete', 'Backspace', 'F1', 'F2', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) || (mod && ['+', '=', '-', '0'].includes(event.key)))) {
    if (!mind.currentNode && ['Tab', 'Enter'].includes(event.key)) mind.selectNode(mind.findEle(mind.nodeData.id))
    event.preventDefault(); event.stopPropagation()
    mind.container.dispatchEvent(new KeyboardEvent('keydown', { key: event.key, code: event.code, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, shiftKey: event.shiftKey, bubbles: true, cancelable: true }))
  }
}, true)
window.addEventListener('blur', () => { void session.save() })
document.addEventListener('visibilitychange', () => { if (document.hidden) void session.save() })
window.addEventListener('beforeunload', event => { if (session.dirty) { event.preventDefault(); event.returnValue = '' } })

applyAppearance()
refreshInspector()
loading = false
updateSaveState('disconnected', '')
if (!pickDirectory) showUnsupported()
else {
  try {
    const handle = await rememberedDirectory()
    if (handle) await session.connect(new BrowserDirectory(handle))
    else { folderDialog.showModal(); updateSaveState(session.state, session.detail) }
  } catch {
    $('folder-dialog-message').textContent = 'No se pudo recuperar la carpeta anterior. Seleccionala nuevamente.'
    folderDialog.showModal()
  }
}
