import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

/**
 * The foot of a capped list: mounts the next page. Renders nothing when nothing
 * is hidden — unless the last page was just revealed from here.
 *
 * Pressing the button on the final page used to unmount the button that had
 * focus, and a keyboard user was dropped on <body>, back at the top of the
 * document (finding webui-8). Now a press that leaves nothing hidden puts a
 * quiet "All shown" line in the button's place and focuses it, so Tab carries on
 * from the foot of the rows that just appeared. A press that still leaves rows
 * hidden keeps the button (and its focus) as before, and a list that was never
 * capped shows nothing at all.
 */
export function ShowMoreRows({
  shown,
  hidden,
  onMore,
}: {
  shown: number
  hidden: number
  onMore: () => void
}) {
  const { t } = useTranslation()
  /** The button was pressed and the list has not hidden a row since. */
  const [pressed, setPressed] = useState(false)
  const summary = useRef<HTMLParagraphElement>(null)
  // Rows still hidden after a press (or hidden again by a later filter): the
  // button is back, and the summary is not owed.
  if (hidden > 0 && pressed) setPressed(false)
  const revealedAll = pressed && hidden <= 0 && shown > 0
  useEffect(() => {
    if (revealedAll) summary.current?.focus()
  }, [revealedAll])

  if (revealedAll) {
    return (
      <div className="flex justify-center pt-3">
        <p ref={summary} tabIndex={-1} className="text-xs text-text-3 outline-none">
          {t('rows.allShown', { total: shown })}
        </p>
      </div>
    )
  }
  if (hidden <= 0) return null
  return (
    <div className="flex justify-center pt-3">
      <Button
        variant="ghost"
        size="sm"
        // Wraps rather than overflowing: at the foot of a 224px board column
        // the longer catalogs ('Tampilkan lebih banyak (100 dari 499)') are
        // wider than the column.
        className="h-auto min-h-7 max-w-full shrink py-1 text-center whitespace-normal"
        onClick={() => {
          setPressed(true)
          onMore()
        }}
      >
        {t('rows.showMore', { shown, total: shown + hidden })}
      </Button>
    </div>
  )
}
