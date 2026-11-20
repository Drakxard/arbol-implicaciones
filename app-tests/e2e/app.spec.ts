import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.me-tpc').first()).toBeVisible()
})

test('edita conceptos y notas, guarda, recarga y deshace', async ({ page }) => {
  await page.getByRole('button', { name: '+ Concepto', exact: true }).click()
  const editor = page.locator('#input-box')
  // The original core opens its inline editor after adding a child.
  await expect(editor).toBeVisible()
  await editor.fill('Límites y continuidad')
  await page.keyboard.press('Enter')
  const concept = page.locator('.me-tpc').filter({ hasText: 'Límites y continuidad' })
  await expect(concept).toBeVisible()
  await concept.click()
  await page.getByLabel('Nota del concepto').fill('¿Existe el límite? Revisar los laterales.')
  await page.getByLabel('Nota del concepto').blur()
  await page.reload()
  await page.locator('.me-tpc').filter({ hasText: 'Límites y continuidad' }).click()
  await expect(page.getByLabel('Nota del concepto')).toHaveValue('¿Existe el límite? Revisar los laterales.')
  await page.getByRole('button', { name: 'Eliminar', exact: true }).click()
  await expect(page.locator('.me-tpc').filter({ hasText: 'Límites y continuidad' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Deshacer', exact: true }).click()
  await expect(page.locator('.me-tpc').filter({ hasText: 'Límites y continuidad' })).toBeVisible()
})

test('exporta e importa JSON, rechaza archivos inválidos sin perder el mapa', async ({ page }) => {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar JSON', exact: true }).click()
  const download = await downloadPromise
  const file = await download.path()
  expect(file).toBeTruthy()
  await page.locator('#file-input').setInputFiles(file!)
  await expect(page.locator('#message')).toContainText('Mapa importado')
  await page.locator('#file-input').setInputFiles({ name: 'roto.json', mimeType: 'application/json', buffer: Buffer.from('{"nodeData":{}}') })
  await expect(page.locator('#message')).toContainText('inválidos')
  await expect(page.locator('.me-tpc').filter({ hasText: 'Mi próximo parcial' })).toBeVisible()
})

test('revisa, aplica y deshace una propuesta de Groq sin llamadas reales', async ({ page }) => {
  await page.route('**/api/ai', route => route.fulfill({ json: {
    summary: 'Una propuesta de estudio', nodes: [
      { id: 'a', parentId: '', topic: 'Derivabilidad', note: 'Revisar definición', relation: '' },
      { id: 'b', parentId: 'a', topic: 'Continuidad', note: 'La recíproca no siempre vale', relation: 'implica' },
    ],
  } }))
  await page.getByLabel('Tema, texto o pregunta').fill('Derivabilidad y continuidad')
  await page.getByRole('button', { name: /Explorar con Groq/ }).click()
  await expect(page.getByRole('region', { name: 'Propuesta de Groq' })).toBeVisible()
  await expect(page.locator('.me-tpc').filter({ hasText: 'Derivabilidad' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Aplicar propuesta' }).click()
  await expect(page.locator('.me-tpc').filter({ hasText: 'Derivabilidad' })).toBeVisible()
  await page.locator('.me-tpc').filter({ hasText: 'Continuidad' }).click()
  await expect(page.getByLabel('Nota del concepto')).toHaveValue('La recíproca no siempre vale')
  await page.getByRole('button', { name: 'Deshacer', exact: true }).click()
  await expect(page.locator('.me-tpc').filter({ hasText: 'Mi próximo parcial' })).toBeVisible()
  await page.getByRole('button', { name: 'Rehacer', exact: true }).click()
  await expect(page.locator('.me-tpc').filter({ hasText: 'Derivabilidad' })).toBeVisible()
})

test('sin clave la IA informa el problema y el editor sigue disponible', async ({ page }) => {
  await page.route('**/api/ai', route => route.fulfill({ status: 503, json: { error: 'Falta configurar GROQ_API_KEY en Vercel.' } }))
  await page.getByLabel('Tema, texto o pregunta').fill('Continuidad')
  await page.getByRole('button', { name: /Explorar con Groq/ }).click()
  await expect(page.locator('#message')).toContainText('GROQ_API_KEY')
  await expect(page.locator('.me-tpc').first()).toBeVisible()
})

test('exporta una imagen PNG', async ({ page }, testInfo) => {
  await page.screenshot({ path: testInfo.outputPath('desktop.png'), fullPage: true })
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'PNG', exact: true }).click()
  const download = await pending
  expect(download.suggestedFilename()).toMatch(/\.png$/)
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(chunk as Buffer)
  expect(Buffer.concat(chunks).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
})

test('se puede usar la interfaz en pantalla pequeña', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('button', { name: '+ Concepto', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.getByLabel('Tema, texto o pregunta').scrollIntoViewIfNeeded()
  await expect(page.getByLabel('Tema, texto o pregunta')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true })
})

test('conserva el guardado dañado hasta una edición explícita', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('arbol-implicaciones:mapa:v1', '{roto'))
  await page.reload()
  await expect(page.locator('.me-tpc').first()).toBeVisible()
  await expect(page.locator('#message')).toContainText('No se pudo recuperar')
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
  expect(await page.evaluate(() => localStorage.getItem('arbol-implicaciones:mapa:v1'))).toBe('{roto')
  await page.getByRole('button', { name: '+ Concepto', exact: true }).click()
  await page.keyboard.press('Enter')
  await expect.poll(() => page.evaluate(() => localStorage.getItem('arbol-implicaciones:mapa:v1'))).not.toBe('{roto')
})
