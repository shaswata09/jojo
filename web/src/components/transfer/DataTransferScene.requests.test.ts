import { describe, expect, it } from 'vitest'
import sceneSource from './DataTransferScene.tsx?raw'
import lazySource from './LazyDataTransferScene.tsx?raw'
import css from './transfer.css?raw'

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

  it('disposes what the picture made: its material, its plane, and both cached textures', () => {
    // Everything disposed in one unmount cleanup, which runs inside R3F's
    // teardown — before the renderer itself goes.
    const cleanup = code.slice(code.indexOf('function Picture'), code.indexOf('function DisposeRenderer'))
    for (const disposal of [
      /parts\.material\.dispose\(\)/,
      /parts\.geometry\.dispose\(\)/,
      // Loader-cached, so they outlive the visit; each renderer that uploaded
      // one left a listener on it that only dispose() releases.
      /colorMap\.dispose\(\)/,
      /depthMap\.dispose\(\)/,
    ]) {
      expect(cleanup).toMatch(disposal)
    }
  })

  it('makes nothing else that would need disposing', () => {
    // No post-processing, render targets, data textures or storage buffers:
    // adding one means adding its disposal to the case above.
    expect(code).not.toMatch(
      /\b(PostProcessing|RenderPipeline|RenderTarget|DataTexture|StorageBufferAttribute|pass)\(|new (PostProcessing|RenderPipeline|RenderTarget|DataTexture)\b/,
    )
  })

  it('draws straight to the canvas, so no shared output quad keeps old renderers', () => {
    // With an sRGB output three renders into a half-float target and copies it
    // out with a quad whose geometry is shared by every renderer; each one left
    // a dispose listener on it, and ten visits kept ten GPU devices alive. The
    // shader encodes sRGB itself and the canvas is declared linear instead.
    expect(code).toMatch(/<Canvas[^>]*\blinear\b[^>]*>/)
    expect(code).toMatch(/sRGBTransferOETF\(/)
  })

  it('builds at most one renderer per canvas, so nothing is left undisposed', () => {
    expect(code).toMatch(/const known = renderers\.get\(canvas\)\s*if \(known\) return known/)
    expect(code).toMatch(/renderers\.set\(canvas, made\)/)
  })
})

/**
 * The live scene and its still have to frame the picture identically — same
 * cover fit, same ground — or switching between them reads as the subject
 * changing. The canvas needs a GPU and the tests run without a DOM, so the
 * contract is pinned as source.
 */

const rules = css.replace(/\/\*[\s\S]*?\*\//g, ' ')

/** Top-level selectors, outside @keyframes bodies. */
function selectors(text: string): string[] {
  const out: string[] = []
  const body = text
    .replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, ' ')
    // Keep a media block's rules, drop its prelude.
    .replace(/@media[^{]*\{/g, ' ')
  for (const match of body.matchAll(/([^{};]+)\{/g)) {
    const selector = match[1].trim()
    if (selector) out.push(...selector.split(',').map((s) => s.trim()))
  }
  return out
}

describe('the transfer scene frame', () => {
  it('scopes every rule under the component class', () => {
    const found = selectors(rules)
    expect(found.length).toBeGreaterThan(0)
    for (const selector of found) expect(selector).toMatch(/^\.transfer-scene\b/)
  })

  it('names its keyframes for the component', () => {
    for (const match of rules.matchAll(/@keyframes\s+([\w-]+)/g)) {
      expect(match[1]).toMatch(/^transfer-scene-/)
    }
  })

  it('draws the same frame and picture in the live scene and the still', () => {
    for (const source of [sceneSource, lazySource]) {
      expect(source).toMatch(/className="transfer-scene__frame"/)
      expect(source).toMatch(/className="transfer-scene__picture" src=\{COLOR_MAP\}/)
    }
  })

  it('paints the shader’s ground behind the still', () => {
    const hex = /const GROUND_HEX = 0x([0-9a-f]{6})/.exec(sceneSource)?.[1]
    expect(hex).toBeDefined()
    expect(rules).toMatch(new RegExp(`--transfer-scene-ground:\\s*#${hex};`))
  })

  it('stops every moving layer of the still under reduced motion', () => {
    const reduced = rules.slice(rules.indexOf('@media (prefers-reduced-motion: reduce)'))
    for (const match of rules.matchAll(/\.(transfer-scene__[\w-]+)\s*\{[^}]*animation:/g)) {
      expect(reduced).toMatch(new RegExp(`\\.${match[1]}\\s*\\{\\s*display:\\s*none`))
    }
  })
})
