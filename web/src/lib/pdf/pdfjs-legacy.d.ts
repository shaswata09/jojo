/**
 * Types for the deep import of pdf.js's legacy build.
 *
 * `pdfjs-dist` points its `types` at the modern entry only, so importing
 * `pdfjs-dist/legacy/build/pdf.mjs` — which is the build this app has to use,
 * see `render.ts` — resolves to no declaration at all. The shapes are identical
 * between the two builds; only the syntax they are compiled to differs. So this
 * says exactly that, rather than restating an API of a hundred names that would
 * then be free to drift from the one actually installed.
 */
declare module 'pdfjs-dist/legacy/build/pdf.mjs' {
  export * from 'pdfjs-dist'
}
