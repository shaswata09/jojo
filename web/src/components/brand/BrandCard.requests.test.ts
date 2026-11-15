import { describe, expect, it } from 'vitest'
import brandCard from '@/components/brand/BrandCard.tsx?raw'
import topbar from '@/components/layout/Topbar.tsx?raw'

/**
 * The sidebar's brand card (G6). Protected design: the card, its robot and its
 * chrome are settled, and these pin the owner's decisions so a refactor cannot
 * quietly undo one.
 *
 * Source reads, because D20 forbids mounting. Comments are stripped first so a
 * sentence about the toggle cannot stand in for the toggle.
 */
const strip = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const card = strip(brandCard)

/** The body of `ThemeToggle`, up to the card itself. */
const toggle = card.slice(card.indexOf('function ThemeToggle'), card.indexOf('export function BrandCard'))

describe('the brand card', () => {
  it('shows the tagline under the jojo name (Q008)', () => {
    const name = card.indexOf('>jojo</div>')
    const tagline = card.indexOf('>Jarvis for Job Organization</p>')
    expect(name).toBeGreaterThan(-1)
    expect(tagline).toBeGreaterThan(name)
  })

  it('renders the 3D Spline robot, not a logo (Q015)', () => {
    expect(card).toMatch(/<SplineRobot\b/)
    expect(card).not.toMatch(/<RobotIcon\b|<img\b/)
  })

  it('puts the theme toggle in the top-right corner of the card (Q027)', () => {
    // The chrome row is absolutely placed top-right, and the toggle is in it.
    const corner = /<div className="absolute top-2 right-2[^"]*">\s*<ThemeToggle\s*\/>/
    expect(card).toMatch(corner)
  })

  it('keeps the theme toggle out of the topbar (Q027)', () => {
    expect(strip(topbar)).not.toMatch(/ThemeToggle|useTheme|toggle\(\)/)
  })

  it('plays the switch click in the same handler that flips the theme (Q029)', () => {
    expect(card).toMatch(/import \{ playSwitchClick \} from '@\/lib\/sound'/)
    // Sound first, then the state change, in one onClick: the two land on the
    // same frame rather than the click trailing as a second event.
    expect(toggle).toMatch(/onClick=\{\(\) => \{\s*playSwitchClick\(\)\s*toggle\(\)\s*\}\}/)
  })
})
