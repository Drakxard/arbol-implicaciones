import { AI_STORAGE_KEY, GROQ_MODEL } from '../shared/groq'

export interface GroqSettings { credential: string; enabled: boolean }
export function readGroqSettings(): GroqSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(AI_STORAGE_KEY) ?? '{}')
    return { credential: typeof raw.credential === 'string' && /^v1\.[\w-]{40,1500}$/.test(raw.credential) ? raw.credential : '', enabled: raw.enabled === true }
  } catch { return { credential: '', enabled: false } }
}
export async function groqRequest(path: 'configure' | 'branch', body: unknown, signal?: AbortSignal) {
  let response: Response
  try { response = await fetch(`/api/groq/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal }) }
  catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    if (error instanceof Error && error.name === 'TimeoutError') throw new Error('El pedido tardó demasiado. Intentá nuevamente.')
    throw new Error('No se pudo contactar al servidor de Groq. Revisá la conexión.')
  }
  let data
  try { data = await response.json() } catch { throw new Error('No se pudo contactar al servidor de Groq.') }
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'No se pudo completar el pedido.')
  return data
}
export function installGroqSettings() {
  const dialog = document.getElementById('groq-dialog') as HTMLDialogElement
  const form = document.getElementById('groq-form') as HTMLFormElement
  const password = document.getElementById('groq-key') as HTMLInputElement
  const enabled = document.getElementById('groq-enabled') as HTMLInputElement
  const error = document.getElementById('groq-error')!
  const save = document.getElementById('groq-save') as HTMLButtonElement
  let request: AbortController | undefined
  document.getElementById('library-settings')!.addEventListener('click', () => {
    const settings = readGroqSettings()
    password.value = ''
    password.placeholder = settings.credential ? 'Clave guardada; escribí otra para reemplazarla' : 'gsk_…'
    enabled.checked = settings.credential ? settings.enabled : true
    error.textContent = ''
    dialog.showModal()
  })
  document.getElementById('groq-close')!.addEventListener('click', () => dialog.close())
  dialog.addEventListener('close', () => { request?.abort(); password.value = ''; save.disabled = false })
  document.getElementById('groq-forget')!.addEventListener('click', () => {
    request?.abort()
    localStorage.removeItem(AI_STORAGE_KEY)
    password.value = ''; password.placeholder = 'gsk_…'; enabled.checked = false; error.textContent = ''
    document.dispatchEvent(new Event('groq-settings-change'))
  })
  form.addEventListener('submit', async event => {
    event.preventDefault()
    request?.abort(); request = new AbortController()
    const current = request
    save.disabled = true; error.textContent = ''
    try {
      let credential = readGroqSettings().credential
      if (password.value.trim()) {
        const data = await groqRequest('configure', { apiKey: password.value.trim() }, current.signal)
        if (typeof data.credential !== 'string' || !/^v1\.[\w-]{40,1500}$/.test(data.credential) || data.model !== GROQ_MODEL) throw new Error('El servidor no devolvió una credencial válida.')
        credential = data.credential
      }
      if (enabled.checked && !credential) throw new Error('Ingresá tu clave de Groq para activar la función.')
      if (current.signal.aborted) return
      localStorage.setItem(AI_STORAGE_KEY, JSON.stringify({ credential, enabled: enabled.checked }))
      document.dispatchEvent(new Event('groq-settings-change'))
      dialog.close()
    } catch (reason) { if (!current.signal.aborted) error.textContent = reason instanceof Error ? reason.message : 'No se pudo guardar la configuración.' }
    finally { if (request === current) save.disabled = false }
  })
}
