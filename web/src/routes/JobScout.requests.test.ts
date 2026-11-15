/**
 * Q128 — "when nothing is left a modal offers to shut down and toggles off on
 * approval." When the modal is raised is `shutdownCandidate`, tested in
 * `use-pipelines.requests.test.ts`. What is left is wiring that exists only in
 * JSX and in a hook nothing here can mount (D20): the page hands the modal's
 * confirm to the engine, and the engine's confirm switches the pipeline OFF —
 * the same toggle the Pipelines card shows. Read out of the source.
 */
import { describe, expect, it } from 'vitest'
import jobScout from './JobScout.tsx?raw'

// Read as text through a `?raw` glob, the one form check-no-copies allows for
// reaching the service source from the app: it instantiates no module.
const pipelineSources = import.meta.glob('../../../service/kg/react/use-pipelines.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>
const usePipelines = Object.values(pipelineSources)[0] ?? ''

/** Source with comments removed, so prose about a prop does not count as the prop. */
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

describe('Q128 approving the shutdown modal turns the pipeline off', () => {
  it('passes the engine’s accept and dismiss to the ShutdownDialog the page mounts', () => {
    const page = code(jobScout)
    expect(page).toMatch(
      /<ShutdownDialog\s+pipeline=\{engine\.shutdownOffer\}\s+onConfirm=\{engine\.acceptShutdown\}\s+onDismiss=\{engine\.dismissShutdown\}/,
    )
  })

  it('switches the offered pipeline off through the same enable tool the toggle uses', () => {
    const hook = code(usePipelines)
    expect(hook).toMatch(
      /const acceptShutdown = useCallback\(\(\) => \{\s*if \(shutdownOffer\) run\('scout\.pipeline\.enable\.set', \{ id: shutdownOffer\.id, enabled: false \}\)/,
    )
    // And the offer itself is the derived candidate, not something set once.
    expect(hook).toMatch(/shutdownCandidate\(pipelines, proposals, running\)/)
  })
})
