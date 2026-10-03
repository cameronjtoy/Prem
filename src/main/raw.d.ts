// Files bundled into the main process as text, e.g. the Python runner (see electron-vite's `?raw` imports).
declare module '*?raw' {
  const text: string
  export default text
}

// Small assets bundled into the main process as data: URIs, e.g. the serif used for PDF headings.
declare module '*?inline' {
  const dataUri: string
  export default dataUri
}
