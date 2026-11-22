import { settingsFrom, type EditorSettings } from './document'

export const TEXT_DEFAULTS_KEY = 'arbol-text-defaults-v1'
export type TextDefaults = Pick<EditorSettings, 'rootColor' | 'rootFontSize' | 'descendantColor' | 'descendantFontSize'>
const keys = ['rootColor', 'rootFontSize', 'descendantColor', 'descendantFontSize'] as const

export function readTextDefaults(storage: Pick<Storage, 'getItem'> = localStorage): Partial<TextDefaults> {
  try {
    const raw = JSON.parse(storage.getItem(TEXT_DEFAULTS_KEY) ?? '{}')
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const clean = settingsFrom({ nodeData: { id: 'defaults', topic: '' }, meta: { editor: {
      rootColor: raw.rootColor, rootFontSize: raw.rootFontSize,
      descendantColor: raw.descendantColor, descendantFontSize: raw.descendantFontSize,
    } } })
    return Object.fromEntries(keys.filter(key => Object.hasOwn(raw, key)).map(key => [key, clean[key]]))
  } catch { return {} }
}
export function writeTextDefaults(defaults: Partial<TextDefaults>, storage: Pick<Storage, 'setItem'> = localStorage) {
  storage.setItem(TEXT_DEFAULTS_KEY, JSON.stringify(defaults))
}
export function withTextDefaults(settings: EditorSettings): EditorSettings {
  return { ...settings, ...readTextDefaults() }
}
