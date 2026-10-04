import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'katex/dist/katex.min.css'
// Bundled fonts for Windows and Linux. macOS uses its own San Francisco (SF Pro and SF Mono) first.
import '@fontsource-variable/inter/opsz.css'
import '@fontsource-variable/inter/opsz-italic.css'
import '@fontsource-variable/source-serif-4/opsz.css'
import '@fontsource-variable/source-serif-4/opsz-italic.css'
import '@fontsource-variable/jetbrains-mono/index.css'
import '@fontsource-variable/jetbrains-mono/wght-italic.css'
import './styles/app.css'
import './styles/editor.css'
import { App } from './App'

// Errors in the window go to Prem's log too, so a problem report can include them.
const logError = (message: string): void => void window.api.app.logError(message).catch(() => {})
window.addEventListener('error', (e) => logError(e.error instanceof Error ? (e.error.stack ?? e.message) : e.message))
window.addEventListener('unhandledrejection', (e) =>
  logError(
    `Unhandled rejection: ${e.reason instanceof Error ? (e.reason.stack ?? e.reason.message) : String(e.reason)}`
  )
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
