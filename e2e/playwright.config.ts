import { defineConfig } from '@playwright/test'

// End-to-end tests drive the built app (npm run build) and the bundled team server (npm run server:build).
// On Linux without a display, run them under xvfb: xvfb-run -a npm run e2e
export default defineConfig({
  testDir: '.',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  retries: 0,
  // The large-vault benchmark is slow; it runs with PREM_SCALE=1 (npm run e2e:scale).
  grepInvert: process.env.PREM_SCALE ? undefined : /@slow/,
  grep: process.env.PREM_SCALE ? /@slow/ : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: '../playwright-report' }]] : 'list',
  outputDir: '../test-results',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' }
})
