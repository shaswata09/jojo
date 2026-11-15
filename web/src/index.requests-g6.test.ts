import { describe, expect, it } from 'vitest'
import css from '@/index.css?raw'
import indexHtml from '../index.html?raw'

/**
 * The theme and the scrollbars, as `index.css` declares them, and the favicon
 * `index.html` names (G6).
 *
 * Read as text (see `test.css` in vite.config.ts for why this import is not
 * empty). Comments are stripped before anything is looked up, so a note about
 * an old value cannot satisfy a check on the current one.
 */
const sheet = css.replace(/\/\*[\s\S]*?\*\//g, ' ')

/** The body of the first rule whose selector starts with `selector`. */
const block = (selector: string) => {
  const start = sheet.indexOf(selector)
  expect(start, `${selector} is in index.css`).toBeGreaterThan(-1)
  const open = sheet.indexOf('{', start)
  return sheet.slice(open + 1, sheet.indexOf('\n}', open))
}

const light = block(":root,\nhtml[data-theme='light']")
const dark = block("html[data-theme='dark']")
const theme = block('@theme inline')

/** A custom property's value in a block. */
const token = (body: string, name: string) =>
  new RegExp(`--${name}:\\s*([^;]+);`).exec(body)?.[1]?.trim()

const isGrey = (hex: string | undefined) => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? '')
  return m !== null && m[1] === m[2] && m[2] === m[3]
}

/** Relative luminance, for "lighter than" without trusting hex order. */
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!)
}

describe('the shadcn/ui neutral theme (Q017)', () => {
  it('maps the shadcn contract onto the app tokens', () => {
    expect(theme).toMatch(/--color-background: var\(--page\);/)
    expect(theme).toMatch(/--color-card: var\(--panel\);/)
    expect(theme).toMatch(/--color-primary: var\(--accent\);/)
    expect(theme).toMatch(/--color-muted: var\(--well\);/)
    expect(theme).toMatch(/--color-border: var\(--hairline\);/)
    expect(sheet).toMatch(/@custom-variant dark \(&:is\(\.dark \*\)\);/)
  })

  it('uses the neutral palette: greys with no hue, and a monochrome primary', () => {
    for (const [name, body] of [['light', light], ['dark', dark]] as const) {
      for (const t of ['page', 'panel', 'well', 'raised', 'hairline', 'text-1', 'accent']) {
        expect(isGrey(token(body, t)), `${name} --${t} = ${token(body, t)}`).toBe(true)
      }
    }
  })

  it('takes shadcn neutral’s foreground and primary in both themes', () => {
    expect(token(light, 'text-1')).toBe('#0a0a0a')
    expect(token(light, 'accent')).toBe('#171717')
    expect(token(dark, 'page')).toBe('#0a0a0a')
    expect(token(dark, 'text-1')).toBe('#fafafa')
    expect(token(dark, 'accent')).toBe('#fafafa')
  })
})

describe('chart and progress colours follow the theme (Q018)', () => {
  it('declares every series and stage colour for each theme separately', () => {
    const names = [
      ...[1, 2, 3, 4, 5].map((n) => `series-${n}`),
      ...['draft', 'submitted', 'screen', 'interview', 'offer', 'closed'].map((s) => `stage-${s}`),
    ]
    for (const name of names) {
      expect(token(light, name), `light --${name}`).toBeDefined()
      expect(token(dark, name), `dark --${name}`).toBeDefined()
    }
    // Retuned for the dark ground rather than copied across.
    expect(token(dark, 'series-1')).not.toBe(token(light, 'series-1'))
  })

  it('hands the charts those tokens', () => {
    for (const n of [1, 2, 3, 4]) {
      expect(theme).toContain(`--color-chart-${n}: var(--series-${n});`)
    }
  })

  it('leaves no fixed colour in the charts, the statistics or the dashboard bars', () => {
    const drawn = import.meta.glob(
      [
        '/src/components/charts/*.tsx',
        '/src/components/statistics/*.tsx',
        '/src/components/dashboard/*.tsx',
      ],
      { query: '?raw', import: 'default', eager: true },
    ) as Record<string, string>
    expect(Object.keys(drawn).length).toBeGreaterThan(5)
    const fixed = Object.entries(drawn)
      .filter(([, src]) =>
        /#[0-9a-f]{6}\b|#[0-9a-f]{3}\b|rgb\(\d/i.test(
          src.replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1'),
        ),
      )
      .map(([file]) => file)
    expect(fixed).toEqual([])
  })
})

describe('the light theme’s surfaces (Q286)', () => {
  it('sets cards apart from the page they sit on', () => {
    expect(token(light, 'panel')).not.toBe(token(light, 'page'))
    expect(token(light, 'well')).not.toBe(token(light, 'panel'))
  })

  it('dims the base white to an off-white', () => {
    const panel = token(light, 'panel')!
    expect(panel).not.toMatch(/^#fff(fff)?$/i)
    expect(luminance(panel)).toBeLessThan(1)
    expect(luminance(panel)).toBeGreaterThan(0.85)
  })
})

describe('the favicon (Q026)', () => {
  const publicFiles = import.meta.glob('/public/*.svg', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>

  it('is declared by index.html and served from public/', () => {
    const href = /<link rel="icon" type="image\/svg\+xml" href="\/([^"]+)"/.exec(indexHtml)?.[1]
    expect(href).toBe('favicon.svg')
    expect(publicFiles[`/public/${href}`]).toBeDefined()
  })

  it('is the robot: the jojo mark with its visor and eyes', () => {
    const svg = publicFiles['/public/favicon.svg'] ?? ''
    expect(svg).toMatch(/aria-label="jojo"/)
    expect(svg).toMatch(/<!--\s*Ears\s*-->/)
    expect(svg).toMatch(/visor/i)
    expect(svg).toMatch(/eyes?/i)
  })
})

describe('glass scrollbars on every scroller (Q036)', () => {
  const thumb = block('::-webkit-scrollbar-thumb {')

  it('paints a translucent, tinted thumb with a sheen and a rim over a clear track', () => {
    expect(block('::-webkit-scrollbar-track,')).toMatch(/background: transparent;/)
    expect(thumb).toMatch(/background-color: var\(--scrollbar-thumb\);/)
    expect(thumb).toMatch(/background-image: linear-gradient\(to bottom, var\(--scrollbar-sheen\), transparent 60%\);/)
    expect(thumb).toMatch(/box-shadow: inset 0 0 0 1px var\(--scrollbar-edge\);/)
    expect(thumb).toMatch(/border-radius: 999px;/)
  })

  it('declares the glass tokens for both themes, translucent in each', () => {
    for (const body of [light, dark]) {
      for (const t of ['scrollbar-thumb', 'scrollbar-sheen', 'scrollbar-edge']) {
        expect(token(body, t)).toMatch(/^rgba\(/)
      }
    }
  })

  it('gives Firefox the same thumb, only where the webkit rules do not apply', () => {
    expect(sheet).toMatch(
      /@supports not selector\(::-webkit-scrollbar\) \{\s*\* \{\s*scrollbar-width: thin;\s*scrollbar-color: var\(--scrollbar-thumb\) transparent;/,
    )
  })
})
