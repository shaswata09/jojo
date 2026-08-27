/**
 * The one assertion that matters: a store too big for Binder is not reported
 * as copied.
 *
 * Settings called `Clipboard.setString(exportJSON())` and then raised "Copied to
 * the clipboard" unconditionally. Android's clipboard module catches
 * `TransactionTooLargeException` and prints it, so an oversized export left the
 * clipboard holding whatever it held before and the screen saying otherwise —
 * on the phone's only backup route, in front of a Clear button whose own
 * confirmation says to export first.
 *
 * So the tests are about what `copy` RECEIVED, not about the returned copy
 * alone: a refusal that still called `setString` would pass any assertion made
 * on the toast.
 */

import { describe, expect, it } from 'vitest'
import { CLIPBOARD_MAX_BYTES, clipboardBytes, copyExport } from './clipboard-export'

/** A JSON-ish payload of exactly `chars` UTF-16 code units. */
const json = (chars: number) => 'a'.repeat(chars)

/** Records what reached the clipboard, so "nothing was copied" is checkable. */
function spy() {
  const copied: string[] = []
  return { copied, copy: (text: string) => copied.push(text) }
}

describe('clipboardBytes — the parcel measure, not the file measure', () => {
  it('counts two bytes a code unit, because the parcel carries UTF-16', () => {
    expect(clipboardBytes('')).toBe(0)
    expect(clipboardBytes('abc')).toBe(6)
  })

  it('counts an astral character as the two units a JS string holds', () => {
    // '\u{1f600}' is one code POINT and two code units, and it is the second
    // number the parcel pays for. Measuring code points would under-count every
    // emoji in somebody's notes and let a payload past the limit.
    expect(clipboardBytes('\u{1f600}')).toBe(4)
  })
})

describe('copyExport — copies, or explains, never both', () => {
  it('copies a store that fits and says so', () => {
    const { copied, copy } = spy()
    const report = copyExport(json(1000), copy)

    expect(copied).toEqual([json(1000)])
    expect(report.title).toBe('Copied to the clipboard')
    expect(report.tone).toBeUndefined()
  })

  it('copies a store sized exactly to the limit', () => {
    const { copied, copy } = spy()
    const report = copyExport(json(CLIPBOARD_MAX_BYTES / 2), copy)

    expect(copied).toHaveLength(1)
    expect(report.title).toBe('Copied to the clipboard')
  })

  it('does not touch the clipboard one code unit over the limit', () => {
    const { copied, copy } = spy()
    const report = copyExport(json(CLIPBOARD_MAX_BYTES / 2 + 1), copy)

    // The whole defect in one line: without the guard this array holds the
    // export, the clipboard holds the old thing, and the toast below says
    // "Copied to the clipboard".
    expect(copied).toEqual([])
    expect(report.tone).toBe('danger')
    expect(report.title).not.toMatch(/copied/i)
  })

  it('names the size and the route that still works', () => {
    const { copy } = spy()
    // A megabyte of records — well within a 50 MB store and well past Binder.
    const report = copyExport(json(1024 * 1024), copy)

    /*
     * The size a PERSON would recognise, not the parcel measure.
     *
     * The guard compares UTF-16 bytes because that is what Binder counts, and
     * this first asserted the same doubled figure — telling someone with a 1 MB
     * export that their records "come to 2.0 MB", which is not a number they
     * can reconcile with anything else the app or their file manager says.
     */
    expect(report.description).toContain('1.0 MB')
    expect(report.description).not.toContain('2.0 MB')
    expect(report.description).toContain('Nothing was copied')
    expect(report.description).toContain('Transfer')
  })

  /**
   * The cap is Binder's, and Binder is Android's.
   *
   * `RNCClipboard.mm` assigns straight to `UIPasteboard.string` — no
   * transaction, no limit — so a blanket guard refused an iPhone a backup it
   * would have taken, and explained why in Android's words. This app ships iOS
   * (16.4+ floor) and the clipboard is the only backup route out of it.
   */
  it('copies on iOS, where there is no Binder limit', () => {
    const { copied, copy } = spy()
    const big = json(1024 * 1024)
    const report = copyExport(big, copy, false)

    expect(copied).toEqual([big])
    expect(report.title).toBe('Copied to the clipboard')
  })

  it('still refuses on Android', () => {
    const { copied, copy } = spy()
    const report = copyExport(json(1024 * 1024), copy, true)

    expect(copied).toEqual([])
    expect(report.tone).toBe('danger')
  })
})
