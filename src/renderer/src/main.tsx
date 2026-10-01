import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'katex/dist/katex.min.css'
// Bundled fonts for Windows and Linux. macOS uses its own San Francisco (SF Pro and SF Mono) first.
import '@fontsource-variable/inter/opsz.css'
import '@fontsource-variable/inter/opsz-italic.css'
import '@fontsource-variable/jetbrains-mono/index.css'
import '@fontsource-variable/jetbrains-mono/wght-italic.css'
import './styles/app.css'
import './styles/editor.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
