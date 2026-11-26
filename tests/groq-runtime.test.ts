import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

test('los endpoints compilados arrancan en Node sin un cargador TypeScript', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'arbol-groq-runtime-'))
  try {
    const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile)
    assert.equal(config.error, undefined)
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd())
    const program = ts.createProgram(['api/groq/configure.ts', 'api/groq/branch.ts'], {
      ...parsed.options, noEmit: false, outDir, rootDir: resolve('.'),
    })
    const emitted = program.emit()
    assert.equal(emitted.emitSkipped, false)
    assert.deepEqual(emitted.diagnostics, [])
    await writeFile(join(outDir, 'package.json'), JSON.stringify({ type: 'module' }))
    for (const action of ['configure', 'branch']) {
      const endpoint = await import(pathToFileURL(join(outDir, 'api/groq', `${action}.js`)).href)
      const response = await endpoint.default.fetch(new Request(`https://app.test/api/groq/${action}`))
      assert.equal(response.status, 405)
      assert.match((await response.json()).error, /permitido/)
    }
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
})
