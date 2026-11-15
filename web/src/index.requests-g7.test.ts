import { describe, expect, it } from 'vitest'
import indexCss from '@/index.css?raw'

/**
 * Q001 — the fonts are self-hosted.
 *
 * jojo is served from wherever its owner puts it and works offline, so a font
 * fetched from Google's CDN is a request to a third party on every load and a
 * missing face whenever there is no network. The faces come from the
 * `@fontsource-variable` packages instead, which Vite copies into the build.
 *
 * Read over everything the page, the worker and the extension are made of, not
 * one stylesheet: a `<link>` in `index.html` or an `@import url(…)` in any CSS
 * file would bring the CDN back just as surely.
 */

const files = import.meta.glob(
  [
    '/index.html',
    '/src/**/*.{ts,tsx,css,html}',
    '/public/**/*.{html,js,mjs,css,json,webmanifest}',
    '/extension/**/*.{js,html,css,json}',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>

/** Assembled, so this file does not name the hosts it is looking for. */
const CDN_HOSTS = ['fonts.' + 'googleapis.com', 'fonts.' + 'gstatic.com']

describe('Q001: fonts are served from the app, not the Google CDN', () => {
  it('names no Google Fonts host anywhere the app ships from', () => {
    const shipped = Object.entries(files).filter(([path]) => !/\.test\.tsx?$/.test(path))
    expect(shipped.length).toBeGreaterThan(200)
    expect(Object.keys(files)).toContain('/index.html')
    const offenders = shipped.filter(([, text]) => CDN_HOSTS.some((host) => text.includes(host))).map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it('imports both faces from the self-hosted fontsource packages', () => {
    expect(indexCss).toMatch(/^@import '@fontsource-variable\/inter';$/m)
    expect(indexCss).toMatch(/^@import '@fontsource-variable\/jetbrains-mono';$/m)
  })
})
