import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './app-tests/e2e', outputDir: 'test-results-app', fullyParallel: true, forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0, workers: process.env.CI ? 2 : undefined,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/app', open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'npm run dev:app -- --port 4173 --strictPort', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI, env: { GROQ_API_KEY: '' } },
})
