import { newDocument, parseDocument } from './document'
import type { MindElixirData } from 'mind-elixir'

export const FILE_NAME = 'mapa-mental.json'
export interface DirectoryPort {
  name: string
  queryPermission(): Promise<PermissionState>
  requestPermission(): Promise<PermissionState>
  read(): Promise<string | null>
  write(text: string): Promise<void>
}
export type SaveState = 'disconnected' | 'loading' | 'ready' | 'pending' | 'saving' | 'saved' | 'permission' | 'error' | 'invalid'

/** One writer, revisions coalesced, and no writes before a successful read. */
export class FolderSession {
  directory: DirectoryPort | null = null
  state: SaveState = 'disconnected'
  detail = ''
  dirty = false
  private writable = false
  private revision = 0
  private timer?: ReturnType<typeof setTimeout>
  private writing: Promise<void> | null = null
  private loadedDirectory: DirectoryPort | null = null
  get hasLoadedDirectory() { return this.loadedDirectory === this.directory && this.directory !== null }
  constructor(private snapshot: () => MindElixirData, private load: (data: MindElixirData) => Promise<void>,
    private notify: (state: SaveState, detail: string) => void, private delay = 500) {}

  private set(state: SaveState, detail = '') { this.state = state; this.detail = detail; this.notify(state, detail) }

  async connect(directory: DirectoryPort, request = false, keepEdits = false): Promise<boolean> {
    clearTimeout(this.timer)
    await this.writing
    this.directory = directory
    this.writable = false
    this.set('loading')
    try {
      const permission = request ? await directory.requestPermission() : await directory.queryPermission()
      if (permission !== 'granted') { this.set('permission', 'La carpeta necesita permiso de lectura y escritura.'); return false }
      // Always read and validate, including reconnects. Never overwrite a broken file.
      const text = await directory.read()
      const data = text === null ? newDocument() : parseDocument(text)
      if (!keepEdits) {
        await this.load(data)
        this.dirty = false
        this.revision++
      }
      this.loadedDirectory = directory
      this.writable = true
      this.set(this.dirty ? 'pending' : text === null ? 'ready' : 'saved')
      if (this.dirty) await this.save()
      return true
    } catch (error) {
      this.set(error instanceof Error && /inválido|válido|formato/.test(error.message) ? 'invalid' : 'error', describeError(error))
      return false
    }
  }

  changed() {
    this.dirty = true
    this.revision++
    clearTimeout(this.timer)
    if (!this.writable) { this.notify(this.state, this.detail); return }
    this.set('pending')
    this.timer = setTimeout(() => { void this.save() }, this.delay)
  }

  save(): Promise<void> {
    clearTimeout(this.timer)
    if (this.writing) return this.writing
    if (!this.dirty || !this.writable || !this.directory) return Promise.resolve()
    this.writing = this.writeLoop().finally(() => { this.writing = null })
    return this.writing
  }

  private async writeLoop() {
    while (this.dirty && this.writable && this.directory) {
      const version = this.revision
      this.set('saving')
      try {
        await this.directory.write(JSON.stringify(this.snapshot(), null, 2))
        if (version === this.revision) this.dirty = false
        this.set(this.dirty ? 'pending' : 'saved')
      } catch (error) {
        this.writable = false
        this.set(error instanceof DOMException && error.name === 'NotAllowedError' ? 'permission' : 'error', describeError(error))
      }
    }
  }

  dispose() { clearTimeout(this.timer) }
}

function describeError(error: unknown) {
  if (error instanceof DOMException && error.name === 'NotAllowedError') return 'No se pudo acceder a la carpeta. Reconectala para renovar el permiso.'
  if (error instanceof DOMException && error.name === 'NotFoundError') return 'No se encuentra la carpeta. Volvé a seleccionarla.'
  return error instanceof Error ? error.message : 'No se pudo leer o guardar el archivo.'
}

export interface WritableDirectoryHandle extends FileSystemDirectoryHandle {
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>
}
export class BrowserDirectory implements DirectoryPort {
  // A first write may create the handle before createWritable fails. Only this
  // session's own empty placeholder can be retried as a missing document.
  private pendingCreation = false
  constructor(public handle: WritableDirectoryHandle) {}
  get name() { return this.handle.name }
  queryPermission() { return this.handle.queryPermission({ mode: 'readwrite' }) }
  requestPermission() { return this.handle.requestPermission({ mode: 'readwrite' }) }
  async read() {
    try {
      const file = await (await this.handle.getFileHandle(FILE_NAME)).getFile()
      const text = await file.text()
      return this.pendingCreation && text === '' ? null : text
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        // Distinguish a missing map from a removed directory.
        await this.handle.resolve(this.handle)
        // Enumerating also makes an unavailable directory fail before we enable writes.
        const iterator = (this.handle as unknown as { keys(): AsyncIterableIterator<string> }).keys()
        await iterator.next()
        return null
      }
      throw error
    }
  }
  async write(text: string) {
    let file: FileSystemFileHandle
    try { file = await this.handle.getFileHandle(FILE_NAME) }
    catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error
      file = await this.handle.getFileHandle(FILE_NAME, { create: true })
      this.pendingCreation = true
    }
    const stream = await file.createWritable()
    try { await stream.write(text); await stream.close(); this.pendingCreation = false }
    catch (error) { await stream.abort().catch(() => {}); throw error }
  }
}

async function handleDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('arbol-local-folder', 1)
    request.onupgradeneeded = () => { request.result.createObjectStore('handles') }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
export async function rememberedDirectory(): Promise<WritableDirectoryHandle | null> {
  const db = await handleDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('handles').objectStore('handles').get('directory')
      request.onsuccess = () => resolve(request.result ?? null)
      request.onerror = () => reject(request.error)
    })
  } finally { db.close() }
}
export async function rememberDirectory(handle: WritableDirectoryHandle): Promise<void> {
  const db = await handleDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('handles', 'readwrite')
      tx.objectStore('handles').put(handle, 'directory')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally { db.close() }
}
