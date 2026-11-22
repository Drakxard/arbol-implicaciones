import { test, expect, type Page } from '@playwright/test'

// Real browser file handles in the Origin Private File System are structured-cloneable
// in IndexedDB. Only the native picker and permission decisions are simulated.
async function fileSystem(page: Page, initial: string | null = null) {
  await page.addInitScript(({ initial }) => {
    const flags = () => sessionStorage
    const nativeWrite = FileSystemFileHandle.prototype.createWritable
    FileSystemFileHandle.prototype.createWritable = function(options) {
      if (flags().getItem('failWrite')) return Promise.reject(new DOMException('Escritura fallida', 'NotAllowedError'))
      return nativeWrite.call(this, options)
    }
    const proto = FileSystemDirectoryHandle.prototype as unknown as Record<string, unknown>
    proto.queryPermission = async () => flags().getItem('permission') ?? 'granted'
    proto.requestPermission = async () => flags().getItem('permission') ?? 'granted'
    const w = window as unknown as Record<string, unknown>
    w.showDirectoryPicker = async () => {
      if (flags().getItem('cancelPicker')) throw new DOMException('Cancelado', 'AbortError')
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Mapas de prueba', { create: true })
      if (initial !== null && !flags().getItem('seeded')) {
        const stream = await (await dir.getFileHandle('mapa-mental.json', { create: true })).createWritable()
        await stream.write(initial); await stream.close(); flags().setItem('seeded', 'yes')
      }
      return dir
    }
  }, { initial })
}
async function connect(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Seleccionar carpeta', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Tu mapa, en tu carpeta' })).not.toBeVisible()
}
async function readFile(page: Page) {
  return page.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Mapas de prueba')
    try { return JSON.parse(await (await (await dir.getFileHandle('mapa-mental.json')).getFile()).text()) }
    catch (e) { if ((e as DOMException).name === 'NotFoundError') return null; throw e }
  })
}
async function root(page: Page) { return page.locator('.me-root > .me-tpc') }

test('inicio limpio, edición, autoguardado y recuperación silenciosa de la carpeta', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await fileSystem(page); await connect(page)
  await expect(page.locator('.me-tpc')).toHaveCount(1)
  const bounds = await (await root(page)).boundingBox()
  expect(Math.abs(bounds!.y + bounds!.height / 2 - 384)).toBeLessThan(2)
  await expect(await root(page)).toHaveCSS('font-family', '"Times New Roman", serif')
  expect(await readFile(page)).toBeNull()
  await (await root(page)).dblclick()
  await page.locator('#input-box').fill('Mi primer mapa')
  await page.keyboard.press('Enter')
  await expect(page.locator('#save-status')).toHaveText('Guardado')
  expect((await readFile(page)).nodeData.topic).toBe('Mi primer mapa')
  await page.reload()
  await expect(await root(page)).toHaveText('Mi primer mapa')
  await expect(page.locator('#folder-dialog')).not.toBeVisible()
  expect(errors).toEqual([])
})

test('paneles, etiquetas, iconos, nota, tamaños y deshacer/rehacer', async ({ page }) => {
  await fileSystem(page); await connect(page)
  await (await root(page)).click(); await page.keyboard.press('Tab')
  await page.locator('#input-box').fill('Nuevo tema'); await page.keyboard.press('Enter')
  const node = page.locator('.me-tpc').filter({ hasText: 'Nuevo tema' })
  await node.click()
  await page.getByLabel('Etiquetas', { exact: true }).fill('uno, dos')
  await page.getByRole('button', { name: 'Icono ⭐', exact: true }).click()
  await page.getByRole('tab', { name: 'Nota', exact: true }).click()
  await page.getByLabel('Nota del nodo').fill('Una nota propia')
  await page.getByRole('tab', { name: 'General', exact: true }).click()
  await page.getByLabel('URL', { exact: true }).fill('https://example.com')
  await page.getByLabel('URL', { exact: true }).blur()
  await page.getByLabel('Tamaño de letra').fill('28')
  await page.getByLabel('Tamaño de letra').dispatchEvent('change')
  await page.getByRole('button', { name: 'Guardar (Ctrl + S)', exact: true }).click()
  await expect(page.locator('#save-status')).toHaveText('Guardado')
  const saved = (await readFile(page)).nodeData.children[0]
  expect(saved.tags).toEqual(['uno', 'dos']); expect(saved.icons).toContain('⭐')
  expect(saved.note).toBe('Una nota propia'); expect(saved.hyperLink).toBe('https://example.com')
  expect(saved.style.fontSize).toBe('28px')
  await page.getByRole('button', { name: 'Deshacer (Ctrl + Z)', exact: true }).click()
  await page.getByRole('button', { name: 'Rehacer (Ctrl + Y)', exact: true }).click()
  await page.reload(); await page.locator('.me-tpc').filter({ hasText: 'Nuevo tema' }).click()
  await page.getByRole('tab', { name: 'Nota', exact: true }).click()
  await expect(page.getByLabel('Nota del nodo')).toHaveValue('Una nota propia')
})

test('configuración global, historial, ramas y panel contraíble', async ({ page }) => {
  await fileSystem(page); await connect(page)
  await page.getByLabel('Tema', { exact: true }).selectOption('Oscuro')
  await page.getByLabel('Estilo de rama').selectOption('orthogonal')
  await page.getByLabel('Fuente', { exact: true }).selectOption('Georgia')
  await page.getByRole('switch', { name: 'Modo compacto' }).check()
  await page.getByLabel('Fuente documental').fill('Mi apunte')
  await page.getByLabel('Fuente documental').blur()
  await page.keyboard.press('Control+s')
  await expect(page.locator('#save-status')).toHaveText('Guardado')
  expect((await readFile(page)).meta.editor).toMatchObject({ theme: 'Oscuro', branchStyle: 'orthogonal', fontFamily: 'Georgia', source: 'Mi apunte' })
  await page.reload()
  await expect(page.getByLabel('Tema', { exact: true })).toHaveValue('Oscuro')
  await expect(page.getByRole('switch', { name: 'Modo compacto' })).toBeChecked()
  await page.getByLabel('Tema', { exact: true }).selectOption('Latte')
  await page.getByRole('button', { name: 'Deshacer (Ctrl + Z)' }).click()
  await expect(page.getByLabel('Tema', { exact: true })).toHaveValue('Oscuro')
  await page.getByRole('button', { name: 'Contraer panel', exact: true }).click()
  await expect(page.locator('#inspector')).toHaveClass('collapsed')
  await page.getByRole('button', { name: 'Expandir panel', exact: true }).click()
  await expect(page.locator('#inspector')).not.toHaveClass('collapsed')
})

test('imágenes locales, proporción y limpieza; notas no activan atajos del mapa', async ({ page }) => {
  await fileSystem(page); await connect(page); await (await root(page)).click()
  await page.getByRole('tab', { name: 'Imagen', exact: true }).click()
  await page.locator('#image-file').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE1sAAAAASUVORK5CYII=', 'base64') })
  await expect(page.getByLabel('Ancho de imagen')).toHaveValue('1')
  await page.getByLabel('Ancho de imagen').fill('100'); await page.getByLabel('Ancho de imagen').blur()
  await expect(page.getByLabel('Alto de imagen')).toHaveValue('100')
  await page.getByRole('tab', { name: 'Nota', exact: true }).click()
  await page.getByLabel('Nota del nodo').fill('Texto normal')
  await page.getByLabel('Nota del nodo').press('Enter')
  await expect(page.locator('.me-tpc')).toHaveCount(1)
  await page.keyboard.press('Control+s')
  await expect(page.locator('#save-status')).toHaveText('Guardado')
  expect((await readFile(page)).nodeData.image.url).toMatch(/^data:image\/png/)
  await page.getByRole('tab', { name: 'Imagen', exact: true }).click()
  await page.getByRole('button', { name: 'Limpiar imagen', exact: true }).click()
  await expect(page.getByLabel('Ancho de imagen')).toHaveValue('')
})

test('atajos, búsqueda, esquema y herramientas de disposición', async ({ page }) => {
  await fileSystem(page); await connect(page)
  await page.getByRole('button', { name: 'Atajos de teclado', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Atajos de teclado' })).toBeVisible()
  await expect(page.getByText('Añadir nodo hijo', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Cerrar atajos', exact: true }).click()
  await page.keyboard.press('Shift+Slash')
  await expect(page.locator('#shortcuts-dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await (await root(page)).click(); await page.keyboard.press('Tab')
  await page.locator('#input-box').fill('Buscar este concepto'); await page.keyboard.press('Enter')
  await page.keyboard.press('Control+f')
  await page.getByRole('searchbox', { name: 'Buscar en el mapa', exact: true }).fill('concepto')
  await expect(page.getByRole('button', { name: 'Buscar este concepto', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Buscar este concepto', exact: true }).click()
  await page.getByRole('button', { name: 'Cerrar búsqueda', exact: true }).click()
  await page.getByRole('button', { name: 'Mostrar izquierda', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Mostrar izquierda', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Mostrar lateral', exact: true }).click()
  await page.getByRole('button', { name: 'Mostrar derecha', exact: true }).click()
  await page.getByRole('button', { name: 'Alternar mapa y esquema', exact: true }).click()
  await expect(page.locator('#outline')).toBeVisible()
  const topic = page.locator('.outline-item-topic').filter({ hasText: 'Buscar este concepto' })
  await topic.fill('Editado en esquema'); await page.keyboard.press('Tab')
  await page.getByRole('button', { name: 'Alternar mapa y esquema', exact: true }).click()
  await expect(page.locator('.me-tpc').filter({ hasText: 'Editado en esquema' })).toBeVisible()
  await page.getByRole('button', { name: 'Deshacer (Ctrl + Z)' }).click()
  await expect(page.locator('.me-tpc').filter({ hasText: 'Buscar este concepto' })).toBeVisible()
})

test('permiso vencido se solicita después del intento silencioso, sin perder cambios', async ({ page }) => {
  await fileSystem(page); await connect(page)
  await (await root(page)).dblclick(); await page.locator('#input-box').fill('Archivo original'); await page.keyboard.press('Enter')
  await expect(page.locator('#save-status')).toHaveText('Guardado')
  await page.evaluate(() => sessionStorage.setItem('permission', 'prompt'))
  await page.reload()
  await expect(page.locator('#connection-banner')).toBeVisible()
  await expect(page.locator('#folder-dialog')).not.toBeVisible()
  await expect(page.locator('#map')).toHaveAttribute('inert', '')
  await page.evaluate(() => sessionStorage.setItem('permission', 'granted'))
  await page.locator('#connect-banner').click()
  await expect(page.locator('#save-status')).toHaveText('Guardado')
  await expect(await root(page)).toHaveText('Archivo original')
  expect((await readFile(page)).nodeData.topic).toBe('Archivo original')
})

test('archivo inválido nunca se sobrescribe', async ({ page }) => {
  await fileSystem(page, '{roto'); await connect(page)
  await expect(page.locator('#save-status')).toContainText('Archivo inválido')
  await expect(page.locator('#map')).toHaveAttribute('inert', '')
  await page.keyboard.press('Control+s')
  expect(await page.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Mapas de prueba')
    return (await (await dir.getFileHandle('mapa-mental.json')).getFile()).text()
  })).toBe('{roto')
})

test('cancelar selector y fallo de escritura permiten volver a intentar', async ({ page }) => {
  await fileSystem(page); await page.goto('/')
  await page.evaluate(() => sessionStorage.setItem('cancelPicker', 'yes'))
  await page.getByRole('button', { name: 'Seleccionar carpeta', exact: true }).click()
  await expect(page.locator('#folder-dialog-message')).toContainText('No se seleccionó')
  await page.evaluate(() => sessionStorage.removeItem('cancelPicker'))
  await page.getByRole('button', { name: 'Seleccionar carpeta', exact: true }).click()
  await expect(page.locator('#folder-dialog')).not.toBeVisible()
  await page.evaluate(() => sessionStorage.setItem('failWrite', 'yes'))
  await (await root(page)).dblclick(); await page.locator('#input-box').fill('Reintentar'); await page.keyboard.press('Enter')
  await expect(page.locator('#save-status')).toHaveText('Reconectar carpeta')
  await page.evaluate(() => sessionStorage.removeItem('failWrite'))
  await page.locator('#connect-banner').click()
  await expect(page.locator('#save-status')).toHaveText('Guardado')
  expect((await readFile(page)).nodeData.topic).toBe('Reintentar')
})

test('navegador incompatible informa el requisito', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'showDirectoryPicker', { value: undefined }) })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Abrí el editor en Chrome o Edge' })).toBeVisible()
  await expect(page.locator('#folder-dialog-message')).toContainText('HTTPS o localhost')
})

test('cambiar de selección conserva las notas en su nodo y Ctrl+S confirma la edición en curso', async ({ page }) => {
  await fileSystem(page); await connect(page)
  await (await root(page)).click(); await page.keyboard.press('Tab')
  await page.locator('#input-box').fill('Primero'); await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.locator('#input-box').fill('Segundo'); await page.keyboard.press('Enter')
  await page.locator('.me-tpc').filter({ hasText: 'Primero' }).click()
  await page.getByRole('tab', { name: 'Nota', exact: true }).click()
  await page.getByLabel('Nota del nodo').fill('Nota solo del primero')
  await page.locator('.me-tpc').filter({ hasText: 'Segundo' }).click()
  await expect(page.getByLabel('Nota del nodo')).toHaveValue('')
  await page.getByLabel('Nota del nodo').fill('Nota del segundo')
  await page.keyboard.press('Control+s')
  await expect(page.locator('#save-status')).toHaveText('Guardado')
  const children = (await readFile(page)).nodeData.children
  expect(children.find((n: { topic: string }) => n.topic === 'Primero').note).toBe('Nota solo del primero')
  expect(children.find((n: { topic: string }) => n.topic === 'Segundo').note).toBe('Nota del segundo')
  await (await root(page)).dblclick(); await page.locator('#input-box').fill('Guardado desde el editor')
  await page.keyboard.press('Control+s')
  await expect(page.locator('#save-status')).toHaveText('Guardado')
  expect((await readFile(page)).nodeData.topic).toBe('Guardado desde el editor')
})

test('zoom, pantalla completa, edición sin cambios y menú contextual original', async ({ page }) => {
  await fileSystem(page); await connect(page)
  await (await root(page)).dblclick(); await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Guardar (Ctrl + S)' }).click()
  expect(await readFile(page)).toBeNull()
  const before = await (await root(page)).boundingBox()
  await page.getByRole('button', { name: 'Acercar', exact: true }).click()
  const after = await (await root(page)).boundingBox()
  expect(after!.width).toBeGreaterThan(before!.width)
  await page.getByRole('button', { name: 'Alejar', exact: true }).click()
  await page.getByRole('button', { name: 'Pantalla completa', exact: true }).click()
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true)
  await page.getByRole('button', { name: 'Pantalla completa', exact: true }).click()
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false)
  await (await root(page)).click({ button: 'right' })
  await expect(page.locator('.context-menu')).toBeVisible()
  await expect(page.locator('.context-menu')).toContainText('hijo')
})
