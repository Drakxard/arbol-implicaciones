import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readTextDefaults, writeTextDefaults, TEXT_DEFAULTS_KEY } from '../app/defaults'

test('los valores compartidos sobreviven a una recarga y validan colores y tamaños', () => {
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
  assert.deepEqual(readTextDefaults(storage), {})
  const defaults = { rootColor: '#123abc', rootFontSize: 40, descendantColor: '#112233', descendantFontSize: 24 }
  writeTextDefaults(defaults, storage)
  assert.deepEqual(readTextDefaults(storage), defaults)
  values.set(TEXT_DEFAULTS_KEY, JSON.stringify({ rootColor: 'bad', rootFontSize: 1000, descendantFontSize: '20' }))
  assert.deepEqual(readTextDefaults(storage), { rootColor: '', rootFontSize: null, descendantFontSize: null })
})

test('valores ausentes no reemplazan estilos anteriores y un registro dañado se ignora', () => {
  const storage = { getItem: () => JSON.stringify({ descendantFontSize: 28 }) }
  assert.deepEqual(readTextDefaults(storage), { descendantFontSize: 28 })
  for (const raw of ['null', '[]', '{malformed']) assert.deepEqual(readTextDefaults({ getItem: () => raw }), {})
  assert.deepEqual(readTextDefaults({ getItem: () => { throw new Error('Storage unavailable') } }), {})
})
