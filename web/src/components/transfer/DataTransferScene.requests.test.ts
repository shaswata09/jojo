import { describe, expect, it } from 'vitest'
import sceneSource from './DataTransferScene.tsx?raw'

/**
 * Review round 3 (leaks-1): the WebGPU renderer the transfer scene builds is
 * ours to dispose — R3F's teardown does not, and three's internal animation
 * loop keeps the whole detached page alive until something does. Pinned as
 * source, since rendering it needs a GPU adapter jsdom does not have.
 */

const code = sceneSource
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\/\/.*$/gm, ' ')

describe('the transfer scene leaving (leaks-1)', () => {
  it('disposes the WebGPU renderer after R3F’s own teardown, and not on a StrictMode rehearsal', () => {
    const dispose = code.slice(code.indexOf('function DisposeRenderer'))
    expect(dispose).toMatch(/clearTimeout\(pending\.current\)/)
    expect(dispose).toMatch(
      /pending\.current = setTimeout\(\(\) => renderer\.dispose\(\), R3F_TEARDOWN_MS \+ \d+\)/,
    )
  })

  it('mounts the disposer inside the canvas', () => {
    expect(code).toMatch(/<DisposeRenderer \/>\s*<\/Canvas>/)
  })

  it('disposes the cached textures and the bloom and scene passes, whose listeners held each past renderer', () => {
    expect(code).toMatch(/rawMap\.dispose\(\)\s*depthMap\.dispose\(\)/)
    expect(code).toMatch(/passes: \[scenePass, bloomPass\]/)
    expect(code).toMatch(/for \(const pass of passes\) pass\.dispose\(\)\s*pipeline\.dispose\(\)/)
  })
})
