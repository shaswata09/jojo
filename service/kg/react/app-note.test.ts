/**
 * The app's own conversation notes read back to their keys, and the `appNote`
 * English saying exactly what each producer writes — so a note changed in
 * `agent/` without the catalog fails here instead of showing in English in
 * every language.
 */

import { describe, expect, it } from 'vitest'
import { domainText, englishT } from '../core/domain-text'
import type { Translate } from '../core/domain-text'
import { TRIM_MARKER } from '../core/model-thread'
import { stubbedNote, summarisedNote, trimNote } from '../agent/budget'
import { TOOLS_OVERFLOW_NOTE } from '../agent/history'
import { CUT_CALL_NOTE, CUT_REPLY_NOTE } from '../agent/round'
import { VERIFY_NOTE } from '../agent/exit'
import { appNoteKey, appNoteText } from './app-note'

const english = domainText(englishT)

/** A translator that shows which key and count it was asked for. */
const keyed: Translate = (key, options) =>
  options?.['count'] === undefined ? `[${key}]` : `[${key}#${String(options['count'])}]`
const tagged = domainText(keyed)

const FIXED = [
  TRIM_MARKER.replies,
  TRIM_MARKER.messages,
  TOOLS_OVERFLOW_NOTE,
  CUT_CALL_NOTE,
  CUT_REPLY_NOTE,
  ...Object.values(VERIFY_NOTE),
]

describe('appNoteText', () => {
  it('renders every fixed app note in English word for word as its producer stored it', () => {
    for (const stored of FIXED) {
      expect(appNoteKey(stored)).not.toBeNull()
      expect(appNoteText(stored, english)).toBe(stored)
    }
  })

  it('renders the counted notes in English word for word as summarisedNote, trimNote and stubbedNote write them, for 1, 2 and 7', () => {
    for (const n of [1, 2, 7]) {
      expect(appNoteText(summarisedNote(n), english)).toBe(summarisedNote(n))
      expect(appNoteText(trimNote(n), english)).toBe(trimNote(n))
      expect(appNoteText(stubbedNote(n), english)).toBe(stubbedNote(n))
    }
  })

  it('reads each note back to its own key and count', () => {
    expect(appNoteText(TRIM_MARKER.replies, tagged)).toBe('[domain:appNote.trimmed.replies]')
    expect(appNoteText(TRIM_MARKER.messages, tagged)).toBe('[domain:appNote.trimmed.messages]')
    expect(appNoteText(TOOLS_OVERFLOW_NOTE, tagged)).toBe('[domain:appNote.toolsOverflow]')
    expect(appNoteText(CUT_CALL_NOTE, tagged)).toBe('[domain:appNote.cutCall]')
    expect(appNoteText(CUT_REPLY_NOTE, tagged)).toBe('[domain:appNote.cutReply]')
    expect(appNoteText(VERIFY_NOTE['stopped-mid-task'], tagged)).toBe(
      '[domain:appNote.verify.stopped-mid-task]',
    )
    expect(appNoteText(summarisedNote(7), tagged)).toBe('[domain:appNote.summarised#7]')
    expect(appNoteText(trimNote(2), tagged)).toBe('[domain:appNote.leftOut#2]')
    expect(appNoteText(stubbedNote(1), tagged)).toBe('[domain:appNote.stubbed#1]')
  })

  it('shows a note it does not recognise exactly as stored', () => {
    const unknown = [
      'Fixed the arguments: a date was reformatted.',
      'Even your own earlier messages did not all fit this model: too long. 3 were left out of this request; your records are untouched.',
      // A counted note whose number does not reproduce it: altered, so not the app's own.
      summarisedNote(3).replace('earliest 3 messages', 'earliest 4 message'),
      `${TRIM_MARKER.replies} `,
      '',
    ]
    for (const stored of unknown) {
      expect(appNoteKey(stored)).toBeNull()
      expect(appNoteText(stored, tagged)).toBe(stored)
    }
  })
})
