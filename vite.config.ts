import { defineConfig, loadEnv } from 'vite'
import { handleGroq } from './server/groq.ts'

export default defineConfig(({ mode }) => ({ build: { outDir: 'dist' }, plugins: [{
  name: 'local-groq',
  configureServer(server) {
    const secret = loadEnv(mode, process.cwd(), 'GROQ_ENCRYPTION_KEY').GROQ_ENCRYPTION_KEY
    if (secret) process.env.GROQ_ENCRYPTION_KEY = secret
    server.middlewares.use(async (req, res, next) => {
      const path = req.url?.split('?')[0]
      if (path !== '/api/groq/configure' && path !== '/api/groq/branch') return next()
      const controller = new AbortController()
      res.on('close', () => { if (!res.writableEnded) controller.abort() })
      try {
        const url = new URL(req.url!, `http://${req.headers.host}`)
        const headers = new Headers()
        for (const [key, value] of Object.entries(req.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(',') : value)
        const { Readable } = await import('node:stream')
        const request = new Request(url, { method: req.method, headers, signal: controller.signal,
          ...(!['GET', 'HEAD'].includes(req.method!) ? { body: Readable.toWeb(req) as ReadableStream, duplex: 'half' } : {}) } as RequestInit)
        const response = await handleGroq(request, path.endsWith('configure') ? 'configure' : 'branch')
        res.writeHead(response.status, Object.fromEntries(response.headers))
        res.end(Buffer.from(await response.arrayBuffer()))
      } catch { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'No se pudo completar el pedido.' })) }
    })
  },
}] }))
