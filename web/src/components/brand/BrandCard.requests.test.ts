import { describe, expect, it } from 'vitest'
import brandCard from '@/components/brand/BrandCard.tsx?raw'
import topbar from '@/components/layout/Topbar.tsx?raw'
import en from '@/i18n/locales/en/brand.json'

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
const toggle = card.slice(
  card.indexOf('function ThemeToggle'),
  card.indexOf('export function BrandCard'),
)

describe('the brand card', () => {
  it('shows the tagline under the jojo name (Q008)', () => {
    const name = card.indexOf('>jojo</div>')
    const tagline = card.indexOf('>Jarvis for Job Organization</p>')
    expect(name).toBeGreaterThan(-1)
    expect(tagline).toBeGreaterThan(name)
  })

  it('renders the 3D robot, not a logo (Q015)', () => {
    expect(card).toMatch(/<JojoRobot\b/)
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

/** The card's JSX from its opening `<Popover>` on. */
const body = card.slice(card.indexOf('export function BrandCard'))

describe('the moves button and the gesture pad', () => {
  it('puts a moves button in the top-left corner that lists every move and ends with the robot credit (Q314)', () => {
    // Same round, light-on-dark chrome as the theme toggle opposite it.
    expect(body).toMatch(
      /<div className="absolute top-2 left-2[^"]*">\s*<PopoverTrigger[^>]*className=\{CORNER_BUTTON\}/,
    )
    expect(toggle).toMatch(/className=\{CORNER_BUTTON\}/)
    const panel = card.slice(
      card.indexOf('function MovesPanel'),
      card.indexOf('function useGesturePad'),
    )
    const list = panel.indexOf('<MoveList')
    const credit = panel.indexOf('<MascotCredit')
    expect(list).toBeGreaterThan(-1)
    expect(credit).toBeGreaterThan(list)
  })

  it('opens the moves beside the card, not over the robot (Q314)', () => {
    expect(body).toMatch(/<Popover>\s*<PopoverAnchor asChild>/)
    // Beside it on a desktop, below it in the phone drawer (review 2026-11-16).
    expect(card).toMatch(/<PopoverContent[^>]*side=\{isDesktop \? 'right' : 'bottom'\}/)
  })

  it('reads strokes drawn on the card and plays the move each names (Q315)', () => {
    expect(body).toMatch(/\{\.\.\.pad\.handlers\}/)
    const pad = card.slice(
      card.indexOf('function useGesturePad'),
      card.indexOf('function ThemeToggle'),
    )
    expect(pad).toMatch(/recognise\(points\)/)
    expect(pad).toMatch(/isDoubleTap\(/)
    expect(pad).toMatch(/play\(poseForStroke\('hold'\)\)/)
    expect(pad).toMatch(/poseForStroke\(double \? 'doubleTap' : id\)/)
    // A finger draws instead of scrolling the drawer.
    expect(body).toMatch(/aria-label=\{t\('poke'\)\}\s*className="[^"]*touch-none/)
    expect(en.poke).toBe('Poke jojo')
  })

  it('still lets the keyboard poke the robot (Q315)', () => {
    expect(body).toMatch(/if \(e\.detail === 0\) play\('nod'\)/)
  })
})

describe('the moves button icon', () => {
  it('shows a robot, not a sparkle (Q320)', () => {
    expect(body).toMatch(/<PopoverTrigger[^>]*>\s*<Bot\b/)
    expect(card).not.toMatch(/Sparkles/)
  })
})
