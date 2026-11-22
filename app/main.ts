import MindElixir, { Outliner, type MindElixirData, type NodeObj, type Theme } from 'mind-elixir'
import { es } from 'mind-elixir/i18n'
import { defaultSettings, newDocument, settingsFrom, safeLink, safeImage, type EditorSettings } from './document'
import { BrowserDirectory, FolderSession, rememberDirectory, rememberedDirectory, type WritableDirectoryHandle, type SaveState, listMaps, mapFileName, type LibraryEntry } from './storage'
import { renderApp, emojis } from './view'
import { mapPreview, moveMap, copyMap, directoryAt, listFolders, createLibraryFolder, trashMap, listTrash, restoreMap, deleteTrashedMap, type TrashedMap } from './library'
import { icon } from './icons'
import { renderMarkdown } from './markdown'
import { installCanvasPan } from './pan'
import { themeFor, textColor, styleDescendants } from './appearance'
import { readTextDefaults, writeTextDefaults, withTextDefaults, type TextDefaults } from './defaults'
import './style.css'

renderApp()
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const field = (id: string) => $<HTMLInputElement>(id)
const folderDialog = $<HTMLDialogElement>('folder-dialog')
let settings = withTextDefaults(defaultSettings())
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

const mind = new MindElixir({ el: '#map', toolBar: false, keypress: true, allowUndo: true, scaleMin: .05, scaleMax: 5,
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
    settings = withTextDefaults(settingsFrom(data))
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

function applyAppearance() {
  const theme: Theme = themeFor(settings)
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
  writeTextDefaults(state.defaults ?? {})
  mind.changeCompact(state.compact)
  applyAppearance()
  refreshInspector()
})
function changeAppearance(change: () => void) {
  const before = { settings: { ...settings }, compact: mind.compact, defaults: readTextDefaults() }
  change()
  applyAppearance()
  const after = { settings: { ...settings }, compact: mind.compact, defaults: readTextDefaults() }
  mind.historyStack!.push('appearance', before, after)
  refreshInspector()
}
function changeTextDefault<K extends keyof TextDefaults>(key: K, value: TextDefaults[K]) {
  changeAppearance(() => {
    writeTextDefaults({ ...readTextDefaults(), [key]: value })
    Object.assign(settings, { [key]: value })
  })
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
  return textColor(node, settings, mind.container)
}
function updateInheritedTextColors() {
  styleDescendants(mind, settings)
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
  $('descendant-settings').hidden = !root
  setColor('descendant-color', settings.descendantColor, '#000000')
  setValue('descendant-font-size', settings.descendantFontSize?.toString() ?? '')
  setColor('node-color', root ? settings.rootColor || node.style?.color : node.style?.color, inheritedTextColor(node))
  setColor('node-background', node.style?.background, root ? '#4c4f69' : '#ffffff')
  field('node-font-size').value = root ? String(settings.rootFontSize ?? parseInt(node.style?.fontSize || '25')) : String(parseInt(node.style?.fontSize || String(settings.descendantFontSize ?? 16)))
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
on('descendant-color', () => changeTextDefault('descendantColor', field('descendant-color').value), 'change')
on('descendant-color-clear', () => changeTextDefault('descendantColor', ''))
on('descendant-font-size', () => {
  const raw = field('descendant-font-size').value
  const value = raw === '' ? null : Number(raw)
  if (value !== null && (!Number.isInteger(value) || value < 10 || value > 64)) {
    toast('El tamaño debe estar entre 10 y 64 píxeles.'); refreshInspector(); return
  }
  changeTextDefault('descendantFontSize', value)
}, 'change')
on('descendant-size-clear', () => changeTextDefault('descendantFontSize', null))
on('source', () => changeAppearance(() => { settings.source = field('source').value }), 'change')
for (const [id, property] of [['node-color', 'color'], ['node-background', 'background']] as const) {
  on(id, () => {
    if (property === 'color' && mind.currentNode?.nodeObj.id === mind.nodeData.id) changeTextDefault('rootColor', field(id).value)
    else return patchNode({ style: { [property]: field(id).value } })
  }, 'change')
  on(`${id}-clear`, () => {
    if (property === 'color' && mind.currentNode?.nodeObj.id === mind.nodeData.id) changeTextDefault('rootColor', '')
    else return patchNode({ style: { [property]: '' } })
  })
}
nodeTextChange('node-tags', value => ({ tags: value.split(',').map(tag => tag.trim()).filter(Boolean) }))
nodeTextChange('node-note', value => ({ note: value }))
on('node-url', async () => {
  const value = field('node-url').value.trim()
  if (value && !safeLink(value)) { toast('El enlace debe comenzar con http:// o https://.'); refreshInspector(); return }
  await patchNode({ hyperLink: value })
}, 'change')
field('node-font-size').addEventListener('input', () => { $('font-size-value').textContent = `${field('node-font-size').value}px` })
on('node-font-size', () => {
  if (mind.currentNode?.nodeObj.id === mind.nodeData.id) changeTextDefault('rootFontSize', Number(field('node-font-size').value))
  else return patchNode({ style: { fontSize: field('node-font-size').value + 'px' } })
}, 'change')
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
async function attachImage(file: Blob, id: string) {
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) throw new Error('Elegí una imagen PNG, JPEG, GIF o WebP.')
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'))
    reader.readAsDataURL(file)
  })
  await applyImage(url, id)
}
on('image-paste', async () => {
  const id = selectedId
  if (!id) return
  if (!navigator.clipboard?.read) throw new Error('Usá Ctrl+V sobre el nodo para pegar la imagen.')
  let items: ClipboardItems
  try { items = await navigator.clipboard.read() }
  catch { throw new Error('No se pudo acceder al portapapeles. Permití el acceso o usá Ctrl+V sobre el nodo.') }
  for (const item of items) {
    const type = item.types.find(type => ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(type))
    if (type) { await attachImage(await item.getType(type), id); return }
  }
  throw new Error('El portapapeles no contiene una imagen compatible.')
})
document.addEventListener('paste', event => {
  if (!$('library').hidden || folderDialog.open || shortcutsDialog.open || !selectedId || !mind.editable) return
  const target = event.target as HTMLElement
  if (target.closest('input, textarea, select, [contenteditable]:not([contenteditable=false])')) return
  const item = Array.from(event.clipboardData?.items ?? []).find(item => item.kind === 'file' && item.type.startsWith('image/'))
  const file = item?.getAsFile()
  if (!file) return
  event.preventDefault(); event.stopImmediatePropagation()
  const id = selectedId
  void attachImage(file, id).catch(error => toast(error.message))
}, true)
on('image-file', async () => {
  const id = selectedId
  const file = field('image-file').files?.[0]
  field('image-file').value = ''
  if (!file) return
  await attachImage(file, id)
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

let libraryEntries: (LibraryEntry & { path?: string[] })[] = []
let libraryFolders: string[] = []
let libraryRoot: WritableDirectoryHandle | null = null
let libraryPath: string[] = []
let inTrash = false
let libraryBusy = false
type Transfer = { mode: 'move' | 'copy'; entry: LibraryEntry; source: FileSystemDirectoryHandle; path: string[] }
let pendingTransfer: Transfer | null = null
let draggedMap: { entry: LibraryEntry; path: string[] } | null = null
const mapDragType = 'application/x-arbol-map'
function folderHandle() { return libraryRoot ?? (session.directory instanceof BrowserDirectory ? session.directory.handle : null) }
async function libraryDirectory() {
  const handle = folderHandle()
  if (!handle) return null
  if (!inTrash) return directoryAt(handle, libraryPath)
  try { return await handle.getDirectoryHandle('.papelera') }
  catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') return null; throw error }
}
async function refreshLibrary() {
  const root = folderHandle()
  if (inTrash) {
    libraryEntries = root ? await listTrash(root) : []
    libraryFolders = []
  } else {
    const handle = await libraryDirectory()
    const [maps, folders] = handle ? await Promise.all([listMaps(handle), listFolders(handle)]) : [[], []]
    libraryEntries = maps; libraryFolders = folders
  }
  $('library-error').hidden = true
  drawLibrary()
}

function closeCreateMenu() {
  $('create-menu').hidden = true; $('create-map').setAttribute('aria-expanded', 'false')
}
function closeLibraryContextMenu() { $('library-context-menu').hidden = true }
async function navigateLibrary(path: string[]) {
  closeCreateMenu(); closeLibraryContextMenu()
  inTrash = false; libraryPath = [...path]; field('library-search').value = ''
  await refreshLibrary()
}
function setDropTarget(element: HTMLElement, path: string[]) {
  element.addEventListener('dragover', event => {
    if (inTrash || pendingTransfer || !event.dataTransfer?.types.includes(mapDragType)) return
    event.preventDefault(); event.dataTransfer.dropEffect = 'move'; element.classList.add('drop-target')
  })
  element.addEventListener('dragleave', event => {
    if (!element.contains(event.relatedTarget as Node | null)) element.classList.remove('drop-target')
  })
  element.addEventListener('drop', event => {
    element.classList.remove('drop-target')
    const dragged = draggedMap
    if (inTrash || pendingTransfer || !dragged || !event.dataTransfer?.types.includes(mapDragType)) return
    event.preventDefault(); event.stopPropagation(); draggedMap = null
    void libraryAction(async () => {
      const root = folderHandle(); if (!root) return
      await moveMap(await directoryAt(root, dragged.path), await directoryAt(root, path), dragged.entry.fileName)
      await refreshLibrary()
    })
  })
}
function drawBreadcrumbs() {
  const nav = $('library-breadcrumbs'); nav.replaceChildren()
  const add = (name: string, path: string[], current = false) => {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = name
    if (current) button.setAttribute('aria-current', 'location')
    button.addEventListener('click', run(() => libraryAction(() => navigateLibrary(path))))
    if (!inTrash) setDropTarget(button, path)
    nav.append(button)
  }
  add('Todas las carpetas', [], !inTrash && libraryPath.length === 0)
  if (inTrash) { const label = document.createElement('span'); label.textContent = ' / Papelera'; nav.append(label); return }
  libraryPath.forEach((name, index) => {
    nav.append(document.createTextNode(' / ')); add(name, libraryPath.slice(0, index + 1), index === libraryPath.length - 1)
  })
}
async function beginTransfer(entry: LibraryEntry, mode: Transfer['mode']) {
  const source = await libraryDirectory(); if (!source || inTrash) return
  pendingTransfer = { mode, entry, source, path: [...libraryPath] }
  closeCreateMenu(); drawLibrary()
}
function updateTransferBar() {
  $('transfer-bar').hidden = !pendingTransfer
  $('library').classList.toggle('choosing-destination', !!pendingTransfer)
  $<HTMLButtonElement>('library-trash').disabled = !!pendingTransfer
  $<HTMLButtonElement>('choose-folder').disabled = !!pendingTransfer
  $<HTMLButtonElement>('create-new-map').disabled = !!pendingTransfer
  if (!pendingTransfer) return
  $<HTMLButtonElement>('transfer-cancel').disabled = libraryBusy
  $('transfer-description').textContent = `${pendingTransfer.mode === 'copy' ? 'Copiar' : 'Mover'} «${pendingTransfer.entry.data.nodeData.topic}» a: /${libraryPath.join('/')}`
  $('transfer-confirm').textContent = pendingTransfer.mode === 'copy' ? 'Copiar aquí' : 'Mover aquí'
  $<HTMLButtonElement>('transfer-confirm').disabled = libraryBusy || (pendingTransfer.mode === 'move' && JSON.stringify(pendingTransfer.path) === JSON.stringify(libraryPath))
}
async function removePermanently(entry: TrashedMap) {
  const root = folderHandle(); if (!root) return
  if (!confirm(`¿Eliminar definitivamente «${entry.data.nodeData.topic}»? Esta acción no se puede deshacer.`)) return
  await deleteTrashedMap(root, entry); await refreshLibrary()
}
function trashContextMenu(event: MouseEvent, entry: TrashedMap) {
  event.preventDefault()
  const menu = $('library-context-menu'); menu.replaceChildren()
  for (const [label, action] of [
    ['Restaurar', async () => { const root = folderHandle(); if (root) { await restoreMap(root, entry); await refreshLibrary() } }],
    ['Eliminar definitivamente', () => removePermanently(entry)],
  ] as const) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.setAttribute('role', 'menuitem')
    button.addEventListener('click', run(() => { closeLibraryContextMenu(); return libraryAction(action) }))
    menu.append(button)
  }
  menu.hidden = false
  const box = menu.getBoundingClientRect()
  menu.style.left = `${Math.max(8, Math.min(event.clientX, innerWidth - box.width - 8))}px`
  menu.style.top = `${Math.max(8, Math.min(event.clientY, innerHeight - box.height - 8))}px`
  menu.querySelector('button')?.focus({ preventScroll: true })
}
function drawLibrary() {
  closeLibraryContextMenu(); closeCreateMenu()
  $('library-home').setAttribute('aria-current', inTrash ? 'false' : 'page')
  $('library-trash').setAttribute('aria-current', inTrash ? 'page' : 'false')
  $('create-controls').hidden = inTrash
  $('empty-trash').hidden = !inTrash
  $<HTMLButtonElement>('empty-trash').disabled = !libraryEntries.length
  drawBreadcrumbs(); updateTransferBar()
  const query = field('library-search').value.trim().toLocaleLowerCase('es')
  const entries = libraryEntries.filter(entry => entry.data.nodeData.topic.toLocaleLowerCase('es').includes(query))
  const cards = $('library-cards')
  cards.replaceChildren()
  const folders = libraryFolders.filter(name => name.toLocaleLowerCase('es').includes(query))
  for (const name of folders) {
    const card = document.createElement('article'); card.className = 'folder-card'
    const button = document.createElement('button'); button.type = 'button'; button.className = 'folder-card-open'; button.setAttribute('aria-label', `Abrir carpeta ${name}`)
    const image = document.createElement('div'); image.className = 'folder-preview'; image.innerHTML = icon('folder')
    const label = document.createElement('div'); label.className = 'map-card-info'; label.textContent = name
    button.append(image, label); card.append(button)
    const path = [...libraryPath, name]
    button.addEventListener('click', run(() => libraryAction(() => navigateLibrary(path))))
    setDropTarget(card, path); cards.append(card)
  }
  for (const entry of entries) {
    const card = document.createElement('article'); card.className = 'map-card'
    const open = document.createElement('button'); open.type = 'button'; open.className = 'map-card-open'
    open.setAttribute('aria-label', `${inTrash ? 'Restaurar' : 'Abrir'} ${entry.data.nodeData.topic}`)
    open.disabled = !!pendingTransfer
    const preview = document.createElement('div'); preview.className = 'map-preview'; preview.append(mapPreview(entry))
    const info = document.createElement('div'); info.className = 'map-card-info'
    const title = document.createElement('div'); title.className = 'map-card-title'; title.textContent = entry.data.nodeData.topic
    const date = document.createElement('time')
    date.textContent = new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(settingsFrom(entry.data).updatedAt))
    info.append(title, date); open.append(preview, info)
    if (inTrash && entry.path?.length) { const origin = document.createElement('small'); origin.textContent = `/${entry.path.join('/')}`; info.append(origin) }
    open.addEventListener('click', run(() => libraryAction(async () => {
      const root = folderHandle(); if (!root) return
      if (inTrash) {
        await restoreMap(root, entry as TrashedMap)
        await refreshLibrary()
      } else {
        const handle = await libraryDirectory()
        if (handle && await session.connect(new BrowserDirectory(handle as WritableDirectoryHandle, entry.fileName))) showEditor()
      }
    })))
    card.append(open)
    if (!inTrash && !pendingTransfer) {
      card.draggable = true
      card.addEventListener('dragstart', event => {
        if (event.target instanceof Element && event.target.closest('.map-card-menu')) { event.preventDefault(); return }
        draggedMap = { entry, path: [...libraryPath] }
        event.dataTransfer?.setData(mapDragType, entry.fileName)
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
        card.classList.add('dragging')
      })
      card.addEventListener('dragend', () => { draggedMap = null; card.classList.remove('dragging'); document.querySelectorAll('.drop-target').forEach(element => element.classList.remove('drop-target')) })
    }
    if (!inTrash) {
      const menu = document.createElement('details'); menu.className = 'map-card-menu'
      const summary = document.createElement('summary'); summary.textContent = '···'; summary.setAttribute('aria-label', `Opciones de ${entry.data.nodeData.topic}`)
      const actions = document.createElement('div'); actions.className = 'map-card-actions'
      for (const [label, mode] of [['Mover a', 'move'], ['Copiar a', 'copy']] as const) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.disabled = !!pendingTransfer
        button.addEventListener('click', run(() => libraryAction(() => beginTransfer(entry, mode))))
        actions.append(button)
      }
      const exports = document.createElement('details')
      const exportLabel = document.createElement('summary'); exportLabel.textContent = 'Exportar'
      exports.append(exportLabel)
      for (const format of ['pdf', 'svg'] as const) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = `Exportar como ${format.toUpperCase()}`
        button.addEventListener('click', run(() => libraryAction(async () => {
          const buttons = Array.from($('library-cards').querySelectorAll<HTMLButtonElement>('.map-card-actions button'))
          buttons.forEach(button => { button.disabled = true })
          try {
            const { exportMap } = await import('./export')
            await exportMap(entry.data, format, message => { toast(message); clearTimeout(toastTimer) })
            toast('Exportación completada.')
            menu.open = false
          } catch (error) { $('toast').hidden = true; throw error }
          finally { buttons.forEach(button => { button.disabled = false }) }
        })))
        exports.append(button)
      }
      const remove = document.createElement('button'); remove.type = 'button'; remove.innerHTML = `${icon('trash')} Mover a la papelera`
      remove.disabled = !!pendingTransfer
      remove.addEventListener('click', run(() => libraryAction(async () => {
        const handle = folderHandle()
        if (!handle) return
        await trashMap(handle, libraryPath, entry.fileName)
        await refreshLibrary()
      })))
      actions.append(exports, remove); menu.append(summary, actions); card.append(menu)
    } else {
      card.addEventListener('contextmenu', event => trashContextMenu(event, entry as TrashedMap))
      const menu = document.createElement('details'); menu.className = 'map-card-menu'
      const summary = document.createElement('summary'); summary.textContent = '···'; summary.setAttribute('aria-label', `Opciones de ${entry.data.nodeData.topic}`)
      const actions = document.createElement('div'); actions.className = 'map-card-actions'
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Eliminar definitivamente'
      remove.addEventListener('click', run(() => libraryAction(() => removePermanently(entry as TrashedMap))))
      actions.append(remove); menu.append(summary, actions); card.append(menu)
    }
    cards.append(card)
  }
  $('library-empty').hidden = entries.length + folders.length > 0
  $('library-empty').textContent = query ? 'No se encontraron mapas.' : inTrash ? 'La papelera está vacía. Hacé clic en un mapa para restaurarlo.' : 'No hay mapas en esta carpeta.'
}
async function libraryAction(action: () => Promise<void>) {
  if (libraryBusy) return
  libraryBusy = true; updateTransferBar()
  try { await action() }
  catch (error) { $('library-error').textContent = error instanceof Error ? error.message : 'No se pudo abrir la biblioteca.'; $('library-error').hidden = false }
  finally { libraryBusy = false; updateTransferBar() }
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
on('library-home', () => libraryAction(() => navigateLibrary([])))
setDropTarget($('library-home'), [])
on('library-trash', () => libraryAction(async () => { closeCreateMenu(); inTrash = true; field('library-search').value = ''; await refreshLibrary() }))
on('create-map', () => {
  const open = $('create-menu').hidden
  $('create-menu').hidden = !open; $('create-map').setAttribute('aria-expanded', String(open))
})
const newFolderDialog = $<HTMLDialogElement>('new-folder-dialog')
on('create-folder', () => {
  closeCreateMenu(); field('new-folder-name').value = ''; $('new-folder-error').hidden = true
  newFolderDialog.showModal(); field('new-folder-name').focus()
})
on('new-folder-cancel', () => newFolderDialog.close())
let creatingFolder = false
$('new-folder-form').addEventListener('submit', event => {
  event.preventDefault()
  if (creatingFolder) return
  creatingFolder = true
  void (async () => {
    try {
      const handle = await libraryDirectory()
      if (!handle || inTrash) throw new Error('Seleccioná una carpeta de biblioteca.')
      await createLibraryFolder(handle, field('new-folder-name').value.trim())
      newFolderDialog.close(); await refreshLibrary()
    } catch (error) {
      $('new-folder-error').textContent = error instanceof Error ? error.message : 'No se pudo crear la carpeta.'
      $('new-folder-error').hidden = false
    } finally { creatingFolder = false }
  })()
})
on('transfer-cancel', () => { if (!libraryBusy) { pendingTransfer = null; drawLibrary() } })
on('transfer-confirm', () => libraryAction(async () => {
  const transfer = pendingTransfer, destination = await libraryDirectory()
  if (!transfer || !destination || inTrash) return
  if (transfer.mode === 'move') await moveMap(transfer.source, destination, transfer.entry.fileName)
  else await copyMap(transfer.source, destination, transfer.entry.fileName)
  pendingTransfer = null; await refreshLibrary()
}))
on('empty-trash', () => libraryAction(async () => {
  const root = folderHandle()
  if (!root || !inTrash || !libraryEntries.length) return
  if (!confirm('¿Vaciar la papelera? Se eliminarán definitivamente todos los mapas de la papelera. Esta acción no se puede deshacer.')) return
  const entries = [...libraryEntries] as TrashedMap[]
  try { for (const entry of entries) await deleteTrashedMap(root, entry) }
  finally { await refreshLibrary() }
}))
document.addEventListener('pointerdown', event => {
  const target = event.target as Element
  if (!target.closest('#create-controls')) closeCreateMenu()
  if (!target.closest('#library-context-menu')) closeLibraryContextMenu()
})
$('library-context-menu').addEventListener('keydown', event => {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const buttons = Array.from($('library-context-menu').querySelectorAll('button'))
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus()
})
on('create-new-map', () => libraryAction(async () => {
  if (pendingTransfer) return
  closeCreateMenu()
  const handle = await libraryDirectory()
  if (!handle) { if (!folderDialog.open) folderDialog.showModal(); return }
  const directory = new BrowserDirectory(handle as WritableDirectoryHandle, null)
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
    libraryRoot = handle; libraryPath = []; pendingTransfer = null
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

let compositionJustEnded = false
document.addEventListener('compositionend', () => {
  compositionJustEnded = true
  setTimeout(() => { compositionJustEnded = false }, 0)
}, true)
document.addEventListener('keydown', event => {
  const mod = event.ctrlKey || event.metaKey
  const key = event.key.toLowerCase()
  if (event.isComposing || event.keyCode === 229 || compositionJustEnded) return
  if (event.key === 'Escape') {
    $('search-panel').hidden = true
    $('search-button').setAttribute('aria-expanded', 'false')
    document.querySelectorAll<HTMLDetailsElement>('details[open]').forEach(menu => { menu.open = false })
    closeCreateMenu(); closeLibraryContextMenu()
  }
  if (document.querySelector('dialog[open]')) return
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
  if (event.key === 'Escape') {
    // Commit through Core's blur handler before its Escape handler can restore the old text.
    event.preventDefault(); event.stopPropagation()
    if (editingMap) { finishMapEdit(); mind.container.focus({ preventScroll: true }) }
    else if (target.closest('#outline [contenteditable]')) target.blur()
    document.querySelectorAll<HTMLDetailsElement>('details[open]').forEach(menu => { menu.open = false })
    mind.container.querySelectorAll<HTMLElement>('.context-menu').forEach(menu => { menu.hidden = true })
    return
  }
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
    if (handle) { libraryRoot = handle; await session.connect(new BrowserDirectory(handle)) }
    else { folderDialog.showModal(); updateSaveState(session.state, session.detail) }
  } catch {
    $('folder-dialog-message').textContent = 'No se pudo recuperar la carpeta anterior. Seleccionala nuevamente.'
    folderDialog.showModal()
  }
}
