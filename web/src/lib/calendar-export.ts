import { useCallback } from 'react'
import { useApplications } from '@jojo/service/react/use-applications'
import { useTimeline } from '@jojo/service/react/use-timeline'
import { ICS_FILENAME, ICS_MIME, buildCalendar, calendarSize } from '@jojo/service/core/ics'

/**
 * Handing jojo's dates to the calendar the user actually gets alerts from.
 *
 * The file is built by `@jojo/service/core/ics`, which is pure and shared with
 * the phone; everything here is the browser half — a Blob, an anchor and the
 * click. That split is why this is eleven lines rather than a second
 * implementation: the parts that can be wrong about an iCalendar file are all
 * on the other side of it, with a test each.
 *
 * WHY A DOWNLOAD RATHER THAN A SUBSCRIPTION. A subscribed calendar would keep
 * itself up to date, and it would need a URL that a calendar server can reach —
 * which means the records leaving the device, which is the one thing this app
 * does not do. A file the user imports keeps the promise and costs them a
 * re-export when the dates change.
 */
export function useCalendarExport() {
  const timeline = useTimeline()
  const applications = useApplications()

  const count = calendarSize({ items: timeline.all, applications: applications.all })

  /**
   * Builds the file and hands it to the browser. Returns false if the browser
   * refused, so the caller can say so rather than claiming a download that
   * never started — the same contract `useBackup().download` keeps.
   */
  const download = useCallback((): boolean => {
    const ics = buildCalendar({
      items: timeline.all,
      applications: applications.all,
      at: new Date().toISOString(),
    })

    let href: string | null = null
    try {
      href = URL.createObjectURL(new Blob([ics], { type: ICS_MIME }))
      const anchor = document.createElement('a')
      anchor.href = href
      anchor.download = ICS_FILENAME
      anchor.click()
      // Revoked on the next task, not synchronously: a synchronous revoke races
      // the download the click just started and the file arrives empty. The
      // Blob URL still gets released — one task later — so it does not pin its
      // bytes for the life of the tab.
      const url = href
      setTimeout(() => URL.revokeObjectURL(url), 0)
      return true
    } catch {
      // Only on the throwing path, where no download was started to race.
      if (href !== null) URL.revokeObjectURL(href)
      return false
    }
  }, [timeline.all, applications.all])

  return { download, count }
}
