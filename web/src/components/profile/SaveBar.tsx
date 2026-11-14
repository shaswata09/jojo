import { Button } from '@/components/ui/button'

/**
 * Sticky at the foot rather than pinned under the header: the fields it
 * governs run the length of the page, and a bar that scrolls away is a
 * bar nobody presses. Mounted always, empty while clean, so the live
 * region exists before the message lands in it — a region that appears
 * with its own content already inside is not announced.
 */
export function SaveBar({
  dirty,
  onDiscard,
  onSave,
}: {
  dirty: boolean
  onDiscard: () => void
  onSave: () => void
}) {
  return (
    <div aria-live="polite" className="sticky bottom-3 z-10 sm:bottom-5">
      {dirty ? (
        <div className="surface flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3">
          {/* Was "saving keeps them for this visit, not to disk". The bar
              exists to make someone press Save; describing the save as
              worthless was an argument against it. */}
          <p className="text-sm text-text-2">
            Unsaved changes — saving writes them to this browser.
          </p>
          <div className="flex gap-2">
            {/* Back to the record, not to a remembered copy of it: dropping
                the edit is what makes the form a view of the store again. */}
            <Button variant="outline" size="sm" onClick={onDiscard}>
              Discard
            </Button>
            <Button size="sm" onClick={onSave}>
              Save
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
