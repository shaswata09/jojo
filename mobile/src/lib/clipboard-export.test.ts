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

  /**
   * The success toast is a claim about the parcel, and the parcel changed.
   *
   * `buildPhoneBackup` sets `documents: []` — deliberately, because file bytes
   * are base64 in a backup and one PDF passes the 512 KiB ceiling on its own —
   * so "The whole store as JSON" survived the repair as a sentence that was no
   * longer true, next to panel copy that already said the opposite. This is a
   * copy assertion because there is nothing else to assert: the drift is
   * between two strings on one screen, and only a test can hold them together.
   */
  it('does not call the parcel the whole store, which it stopped being', () => {
    const { copy } = spy()
    const report = copyExport(json(1000), copy)

    expect(report.description).not.toMatch(/whole store/i)
    // The half a person clearing their records needs: the rows travel and the
    // files do not.
    expect(report.description).toMatch(/documents .*stay on this phone/)
  })

  /**
   * And it does not offer Transfer as the route that carries them.
   *
   * This assertion used to be `toMatch(/transfer/i)` — it PINNED the claim.
   * `screens/TransferScreen.tsx` says in its own header that the phone cannot
   * send: a browser cannot accept an inbound connection, so the phone is always
   * the side that listens, and sending "points at the export under Settings",
   * which is this very button. The oversize branch said "Use Transfer instead"
   * and Transfer said "use the export", so a user whose store was too big was
   * sent round a circle — and this test held one end of it in place.
   *
   * Two more copies of the same claim were found by a source-text guard in
   * `instant-day.test.ts` once the phrasing was banned there: SettingsScreen's
   * "or Transfer, which hands the whole store to another device", and the
   * phone guide's "Transfer sends a copy straight to your other device".
   */
  it('does not offer Transfer as a way to send, on either branch', () => {
    const { copy } = spy()
    expect(copyExport(json(1000), copy).description).not.toMatch(/transfer[^.]*\b(sends?|carries|hands)\b/i)

    const oversize = copyExport(json(CLIPBOARD_MAX_BYTES), copy, true)
    expect(oversize.tone).toBe('danger')
    expect(oversize.description).not.toMatch(/use transfer instead/i)
    // It says what is actually true, so the reader is not sent looking.
    expect(oversize.description).toMatch(/only way out of this phone/i)
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
