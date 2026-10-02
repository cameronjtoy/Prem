// Files bundled into the main process as text, e.g. the Python runner (see electron-vite's `?raw` imports).
declare module '*?raw' {
  const text: string
  export default text
}
