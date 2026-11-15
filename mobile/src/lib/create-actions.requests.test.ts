/**
 * Q131 on the phone — "yes do it for mobile": with a model connected, the +
 * menu offers an application from a link, the paste row's "From link" starts
 * the read, and a read posting opens the create sheet prefilled and carrying
 * the kept page. Web's half is `web/src/lib/create-actions.requests.test.ts`
 * and `web/src/components/applications/*.requests.test.ts`.
 *
 * These files import React Native and navigation, which this runner does not
 * load (see vitest.config.mts), so they are read as text with comments removed.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) =>
  readFileSync(path.join(SRC, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

describe('Q131 an application from a link, on the phone', () => {
  it('has a + menu row for it that only shows with a model', () => {
    const actions = read('lib/create-actions.ts')
    expect(actions).toMatch(
      /id: 'new-application-from-link',[\s\S]{0,200}?sheet: \{ name: 'applicationFromLink' \},\s*requires: 'model',/,
    )
    expect(actions).toMatch(
      /const hasModel = isConfigured\(settings\)\s*return CREATE_ACTIONS\.filter\(\(action\) => action\.requires !== 'model' \|\| hasModel\)/,
    )
  })

  it('starts the read from the paste row when a model is connected', () => {
    expect(read('screens/ApplicationsScreen.tsx')).toMatch(
      /if \(connected\) open\('applicationFromLink', \{ url: text, start: true \}\)\s*else open\('application', \{ initial: draftFromUrl\(text\) \}\)/,
    )
  })

  it('opens the create sheet from the model’s draft, carrying the kept page', () => {
    expect(read('sheets/AddFromLinkSheet.tsx')).toMatch(
      /openSheet\('application', \{\s*mode: 'create',\s*initial: \{\s*\.\.\.outcome\.draft,[\s\S]{0,300}?postingFileId: outcome\.file\.id,/,
    )
  })
})
