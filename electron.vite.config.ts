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
        "img-src 'self' data:",
        "font-src 'self' data:",
        `connect-src ${connect}`
      ].join('; ')
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`
      )
    }
  }
}

export default defineConfig({
  main: {
    resolve: { alias },
    build: { externalizeDeps: { exclude: ['chokidar'] } }
  },
  preload: {
    resolve: { alias }
  },
  renderer: {
    resolve: { alias },
    plugins: [react(), contentSecurityPolicy()]
  }
})
