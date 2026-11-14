/**
 * The code flow graph, served by the `jojo:code-graph` plugin in `vite.config.ts`.
 *
 * `unknown` here and typed at the one import site: an ambient module cannot
 * reference `scripts/code-graph.mjs` by a relative path, so the shape lives
 * there, in `CodeGraph`.
 */
declare module 'virtual:jojo-code-graph' {
  const graph: unknown
  export default graph
}
