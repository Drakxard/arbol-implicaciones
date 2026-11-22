import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newDocument, parseDocument, settingsFrom } from '../app/document'

test('los mapas anteriores conservan valores predeterminados para descendientes', () => {
  const data = newDocument()
  data.meta = { editor: { formatVersion: 1 } }
  assert.equal(settingsFrom(data).descendantColor, '')
  assert.equal(settingsFrom(data).descendantFontSize, null)
})

test('ajustes de descendientes persisten y rechazan valores fuera de rango', () => {
  const data = newDocument()
  data.meta!.editor.descendantColor = '#123abc'
  data.meta!.editor.descendantFontSize = 32
  const restored = parseDocument(JSON.stringify(data))
  assert.equal(settingsFrom(restored).descendantColor, '#123abc')
  assert.equal(settingsFrom(restored).descendantFontSize, 32)
  for (const invalid of [9, 65, 16.5, '20', null]) {
    data.meta!.editor.descendantFontSize = invalid
    assert.equal(settingsFrom(data).descendantFontSize, null)
  }
  data.meta!.editor.descendantColor = 'invalid'
  assert.equal(settingsFrom(data).descendantColor, '')
})
