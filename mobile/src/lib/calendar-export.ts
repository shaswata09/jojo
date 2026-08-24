import ReactNativeBlobUtil from 'react-native-blob-util'
import { ICS_FILENAME, buildCalendar, calendarSize } from '@jojo/service/core/ics'
import type { Application, TimelineItem } from '@jojo/service/core/model'
import { openDocument } from '@/lib/documents'

export { calendarSize }

/**
 * Handing jojo's dates to the calendar the phone actually alerts from.
 *
 * The file itself is built by `@jojo/service/core/ics`, which is pure and shared
 * with the web app; this is the phone half — write it down, then ask the OS who
 * wants it. `openDocument` is the same handoff a Vault document uses, so a
 * calendar app receives this exactly the way a PDF viewer receives a CV.
 *
 * WHY THIS MATTERS MORE HERE THAN ON THE WEB. On a laptop the export is a
 * convenience; on a phone it is the only path jojo has to a notification. The
 * app has none of its own, so an alert about tomorrow's deadline can only come
 * from the calendar the user already carries.
 *
 * WRITTEN TO THE DOCUMENT DIRECTORY, beside the captures, rather than to a
 * cache the OS may reclaim between the write and the chooser. It is overwritten
 * on every export — one file per device, not one per press, so a user who
 * exports monthly does not accumulate twelve of them where nothing lists them.
 */
const exportPath = () => `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/${ICS_FILENAME}`

export type CalendarSource = {
  items: readonly TimelineItem[]
  applications: readonly Application[]
}

/**
 * Writes the file and hands it to whatever on this phone opens a calendar.
 *
 * Throws rather than returning a Result, for the reason `openDocument` gives:
 * the caller is a press handler with somewhere to put the message, and every
 * failure here is one sentence — nothing offered to open it.
 */
export async function exportCalendar(source: CalendarSource): Promise<number> {
  const ics = buildCalendar({ ...source, at: new Date().toISOString() })
  const path = exportPath()
  await ReactNativeBlobUtil.fs.writeFile(path, ics, 'utf8')
  await openDocument(`file://${path}`)
  return calendarSize(source)
}
