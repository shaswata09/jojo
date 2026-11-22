import { describe, expect, it } from 'vitest'
import mascotLight from '@/components/brand/MascotLight.tsx?raw'
import mascotLightCss from '@/components/brand/mascot-light.css?raw'

/**
 * The light behind the sidebar mascot: a faint beam from beyond the card's
 * top-left corner, written in-house to replace a third-party component. It is
 * decoration, so it must never be announced or take a click, it sits under
 * the robot, and it enters once and then holds still. Source reads (D20).
 */
const strip = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const code = strip(mascotLight)
const css = strip(mascotLightCss)

/** The body of the first top-level rule for `selector`. */
const rule = (selector: string) => {
  const at = css.search(new RegExp(`(^|\\n)${selector.replace(/[.-]/g, '\\$&')}\\s*\\{`))
  if (at < 0) return ''
  const open = css.indexOf('{', at)
  return css.slice(open + 1, css.indexOf('}', open))
}

const wrapper = rule('.jojo-mascot-light')
const beam = rule('.jojo-mascot-light-beam')

describe('the mascot light', () => {
  it('is hidden from assistive tech and brings its own stylesheet', () => {
    expect(code).toMatch(/export function MascotLight\(/)
    expect(code).toMatch(/aria-hidden="true"/)
    expect(code).toMatch(/className=\{cn\('jojo-mascot-light', className\)\}/)
    expect(code).toMatch(/import '\.\/mascot-light\.css'/)
  })

  it('never takes a pointer, and lies under the robot', () => {
    expect(wrapper).toMatch(/pointer-events:\s*none;/)
    expect(wrapper).toMatch(/position:\s*absolute;/)
    expect(wrapper).toMatch(/z-index:\s*1;/)
  })

  it('enters once, then holds still', () => {
    const animation = /animation:\s*([^;]+);/.exec(beam)?.[1] ?? ''
    expect(animation).toMatch(/^jojo-mascot-light-enter\b/)
    expect(animation).toMatch(/\s1\s/)
    expect(animation).toMatch(/\bboth$/)
    expect(css).not.toMatch(/\binfinite\b/)
    expect(css).not.toMatch(/animation-iteration-count/)
    expect(css).toMatch(/@keyframes jojo-mascot-light-enter\s*\{\s*from\s*\{/)
    // Cheap: no animation loop or canvas of its own.
    expect(code).not.toMatch(/requestAnimationFrame|<canvas|useEffect/)
  })

  it('appears in its final state, without moving, under reduced motion', () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.jojo-mascot-light-beam\s*\{\s*animation:\s*none;\s*\}\s*\}/,
    )
    // That works only because the resting style is the end frame: the
    // keyframes say where the beam starts, never where it ends.
    expect(css).not.toMatch(/@keyframes jojo-mascot-light-enter[\s\S]*?\bto\s*\{/)
  })
})
