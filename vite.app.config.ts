import { defineConfig, loadEnv } from 'vite'
import handler from './api/ai'

export default defineConfig(({ mode }) => {
  // These variables are read by Node only. They are never exposed through VITE_*.
  const env = loadEnv(mode, process.cwd(), '')
  for (const name of ['GROQ_API_KEY', 'GROQ_MODEL']) if (env[name] && !process.env[name]) process.env[name] = env[name]
  return {
    server: { host: '127.0.0.1' },
    build: { outDir: 'dist' },
    plugins: [{
      name: 'groq-local-api',
      configureServer(server) {
        server.middlewares.use('/api/ai', (req, res) => { void handler(req, res).catch(() => {
          res.statusCode = 500
          res.end(JSON.stringify({ error: 'Error inesperado del servidor.' }))
        }) })
      },
    }],
  }
})
