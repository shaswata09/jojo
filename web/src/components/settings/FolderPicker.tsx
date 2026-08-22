import { useEffect, useState } from 'react'
import { FolderOpen, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  chooseFolder,
  disconnectFolder,
  fileStore,
  reconnectFolder,
  restoreFolder,
  type FolderStatus,
} from '@/kg/storage/folder-connect'

/** Stamped into a new folder's marker, so a folder records what wrote it. */
const APP_VERSION = 'jojo-web'

/**
 * Picks the folder jojo saves files into, and shows which one that is.
 *
 * Replaces a text input that read `~/jobsearch/jojo-data.json` and did nothing.
 * A path a person types is the wrong control for this on the web whatever it is
 * wired to: the browser cannot be told a path, only handed a directory the user
 * chose in the OS dialog, and the grant that comes with it is the thing being
 * stored — not the string.
 *
 * ## Why only a name is shown
 *
 * The File System Access API never exposes a full path; `handle.name` is the
 * leaf folder and that is all there is. So this reads "Documents", not
 * "/Users/you/Documents". That is a deliberate part of the API — a page that
 * could read your directory layout learns a lot about you — and not something a
 * different implementation could improve on. Saying "the folder you picked"
 * beside the name is what keeps it honest rather than looking truncated.
 *
 * ## The four states, and why permission is its own
 *
 * A handle survives a reload; the permission on it does not always. That is not
 * a broken folder and must not read as one — it is one click to restore, which
 * is why `needs-permission` gets its own copy and its own button instead of
 * falling in with "no folder".
 */
export function FolderPicker() {
  const [status, setStatus] = useState<FolderStatus>({ state: 'none' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    // Never prompts — see `restoreFolder`. Asking for permission on load would
    // put an OS dialog in front of someone who has not clicked anything.
    void restoreFolder(fileStore).then((s) => {
      if (alive) setStatus(s)
    })
    return () => {
      alive = false
    }
  }, [])

  const run = (fn: () => Promise<FolderStatus | null>) => async () => {
    setBusy(true)
    try {
      const next = await fn()
      // `null` is the user dismissing the OS dialog. Cancelling is the most
      // common thing a person does with a file picker and it is not an outcome
      // worth reporting, so the previous state stands.
      if (next !== null) setStatus(next)
    } finally {
      setBusy(false)
    }
  }

  const now = () => new Date().toISOString()

  if (status.state === 'unsupported') {
    return (
      <div className="flex items-start gap-2.5 rounded-lg border border-hairline bg-well px-3 py-2.5 text-xs text-text-2">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.8} aria-hidden />
        <p>
          This browser cannot open a folder. Choosing one needs the File System Access API, which
          today means Chrome or Edge — Firefox and Safari have not shipped it. Everything else in
          jojo works here; only saving a copy outside the browser does not.
        </p>
      </div>
    )
  }

  const connected = status.state === 'connected'
  const lapsed = status.state === 'needs-permission'
  const gone = status.state === 'gone'

  return (
    <div>
      <div className="mb-1.5 text-xs text-text-2">Where to save it</div>
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="min-w-0 flex-1 truncate rounded-lg border border-hairline bg-well px-3 py-2 font-mono text-sm text-text-1"
          // The value is a folder name the user picked, not a control. It reads
          // as a field so it sits with the others, but there is nothing to type
          // into and nothing to focus.
          aria-live="polite"
        >
          {connected || lapsed || gone ? status.name : 'No folder chosen'}
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={run(() =>
            lapsed || gone
              ? reconnectFolder(fileStore, { now: now(), appVersion: APP_VERSION })
              : chooseFolder(fileStore, { now: now(), appVersion: APP_VERSION }),
          )}
        >
          <FolderOpen className="size-3.5" strokeWidth={1.8} aria-hidden />
          {lapsed ? 'Allow again' : gone ? 'Choose again' : connected ? 'Change' : 'Select path'}
        </Button>
        {connected ? (
          <Button variant="ghost" size="sm" disabled={busy} onClick={run(() => disconnectFolder(fileStore))}>
            Disconnect
          </Button>
        ) : null}
      </div>

      <p className="mt-1.5 text-xs text-text-3">
        {connected
          ? 'jojo can write into this folder. Only the folder name is shown — the browser never tells a page its full path.'
          : lapsed
            ? 'This folder is still remembered, but the browser needs your permission again after a restart.'
            : gone
              ? 'That folder is no longer where it was — moved, renamed, or on a drive that is not attached.'
              : 'Pick a folder and jojo keeps a copy of your files in it, outside the browser.'}
      </p>
    </div>
  )
}
