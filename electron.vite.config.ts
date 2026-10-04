import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const alias = { '@shared': resolve(__dirname, 'src/shared') }

// Dev needs inline scripts (React Refresh preamble) and a websocket for HMR; production does not.
function contentSecurityPolicy(): Plugin {
  let isDev = false
  return {
    name: 'content-security-policy',
    configResolved(config) {
      isDev = config.command === 'serve'
    },
    transformIndexHtml(html) {
      const script = isDev ? "'self' 'unsafe-inline'" : "'self'"
      const connect = isDev ? "'self' ws:" : "'self'"
      const csp = [
        "default-src 'self'",
        `script-src ${script}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        `connect-src ${connect}`,
        // Nothing else: no plugins, frames, forms or <base> tricks.
        "object-src 'none'",
        "frame-src 'none'",
        "form-action 'none'",
        "base-uri 'none'"
      ].join('; ')
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`)
    }
  }
}

export default defineConfig({
  main: {
    resolve: { alias },
    build: { externalizeDeps: { exclude: ['chokidar', 'electron-updater'] } },
    // Auto-update only runs in builds signed by the release workflow (see src/shared/updates.ts).
    define: { PREM_SIGNED_BUILD: JSON.stringify(!!(process.env.CSC_LINK || process.env.WIN_CSC_LINK)) }
  },
  preload: {
    resolve: { alias }
  },
  renderer: {
    resolve: { alias },
    plugins: [react(), contentSecurityPolicy()]
  }
})
