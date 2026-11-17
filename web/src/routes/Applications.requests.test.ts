/**
 * Q045 — "Add the same URL textbox beside Add application button on the
 * Applications page."
 *
 * The page header carries `AddByUrl` — the same component, not a copy — in
 * the actions slot right before the New application button. What the box does
 * is `add-by-url.requests.test.ts`. JSX only, so read as source (D20).
 */
import { describe, expect, it } from 'vitest'
import source from './Applications.tsx?raw'
import pagesCatalog from '@/i18n/locales/en/pages.json?raw'

const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

describe('Q045 the Applications page has the paste-a-URL box beside New application', () => {
  it('uses the shared AddByUrl component', () => {
    expect(code).toContain("import { AddByUrl } from '@/components/applications/AddByUrl'")
  })

  it('puts it in the header actions, immediately before the New application button', () => {
    expect(JSON.parse(pagesCatalog).applications.newApplication).toBe('New application')
    expect(code).toMatch(
      /actions=\{\s*<>\s*\{?\s*\}?\s*<AddByUrl[^>]*\/>\s*<Button size="sm" onClick=\{\(\) => onNew\(\)\}>[\s\S]{0,160}?\{t\('applications\.newApplication'\)\}\s*<\/Button>/,
    )
  })
})
