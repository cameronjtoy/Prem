import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// Builds the team server into one Node script. Everything is bundled so the output runs with plain `node`.
export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  ssr: { noExternal: true },
  build: {
    ssr: resolve(__dirname, 'src/server/index.ts'),
    outDir: 'out/server',
    emptyOutDir: true,
    target: 'node20',
    rollupOptions: { output: { entryFileNames: 'index.js', format: 'cjs' } }
  }
})
