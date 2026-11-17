/**
 * Review finding web-1: choosing Edit on a second person while the first one's
 * form was open kept the first person's values, and Save overwrote the second
 * person with them (and "Add person" from an open edit saved a copy).
 *
 * The form seeds its draft once, at mount; what keeps it honest is the key in
 * the JSX, so D20 leaves a narrow source read.
 */

import { describe, expect, it } from 'vitest'
import source from './PeopleTool.tsx?raw'

describe('the person form follows the person it edits (web-1)', () => {
  it('is keyed by its subject, so switching remounts it with fresh values', () => {
    expect(source).toMatch(/<PersonForm[\s\S]*?key=\{editing \? editing\.id : 'new'\}/)
  })
})
