import { ShieldAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Kbd } from '@/components/guide/Kbd'
import { Go } from '@/components/guide/overview/Go'
import { SavePath } from '@/components/guide/overview/SavePath'
import { settingsPath, transferPath } from '@/lib/links'

/**
 * The strips that can appear above the page, and what each one means.
 *
 * These are the one part of jojo a reader cannot be shown by following a link:
 * you cannot fill someone's disk or corrupt their database to demonstrate the
 * recovery screen. So they are written out, in the words the banner itself uses,
 * with the answer beside each — which is the whole reason this section exists.
 * Copy verified line by line against `layout/StorageBanner.tsx`.
 */
const BANNERS: { says: string; means: ReactNode }[] = [
  {
    says: 'jojo could not open its database',
    means: (
      <>
        Another jojo tab is open on a different version of the app. Your records are still on disk —
        this tab could not read them, so it shows nothing rather than guessing. Close the other tabs
        and reload.
      </>
    ),
  },
  {
    says: 'This browser is not letting jojo open its storage',
    means: (
      <>
        A private window, or a browser your organisation manages. jojo still runs, but as a blank
        workspace: what is already saved on this device is not shown, and anything you type goes
        when you close the tab. Export before you leave if you add anything worth keeping.
      </>
    ),
  },
  {
    says: 'jojo was updated in another tab',
    means: (
      <>
        A new version loaded elsewhere and this tab closed its database to let the update through.
        Nothing you change here is being saved. Reload.
      </>
    ),
  },
  {
    says: 'This browser has no room left',
    means: (
      <>
        Saving has stopped, and the banner counts the changes that are on screen but not written.
        There is deliberately no Reload button on this one — reloading is exactly what would lose
        them. Export first, free some space, then reload.
      </>
    ),
  },
  {
    says: 'N changes could not be saved',
    means: (
      <>
        jojo is still retrying and the queue drains in order, so this is a number that can go down
        on its own. Export if you need a copy now.
      </>
    ),
  },
  {
    says: 'N records could not be read',
    means: (
      <>
        Something on disk did not match what jojo expects, so it is being left out rather than shown
        half-read. Nothing has been deleted, and Settings &rarr; Diagnostics names the records by
        id.
      </>
    ),
  },
]

export function DataSection() {
  return (
    <Panel id="data" className="scroll-mt-4">
      <PanelTitle hint="where it is, and what can go wrong">Your data</PanelTitle>

      <h3 className="text-sm font-medium">The question jojo asked once</h3>
      <p className="mt-1 text-sm text-text-2">
        On its first run jojo asks whether to start with demo data or empty, and it will not let you
        dismiss the question — a stranger looking at twelve applications for employers they have
        never contacted has no way to tell whether the app invented them or restored someone
        else&rsquo;s. It is asked once because the answer is recorded, and neither answer is final:{' '}
        <Go to={settingsPath()}>Settings &rarr; Your data</Go> has both halves, and clearing the
        demo records does not bring the question back.
      </p>

      <h3 className="mt-4 text-sm font-medium">Nothing waits on the disk</h3>
      <div className="mt-2 grid grid-cols-1 gap-4 lg:grid-cols-[auto_1fr] lg:gap-6">
        <SavePath />
        <p className="min-w-0 text-sm text-text-2">
          A change is on screen the instant you make it, and written to the browser&rsquo;s database
          a moment later in the background. That is why there are no spinners on save, and why
          closing the tab is safe — jojo flushes what it is holding when the tab is hidden or
          closed, including on a phone that kills the tab without warning. It is also why the
          &ldquo;no room left&rdquo; banner below has no Reload button: your unsaved change is
          sitting in that queue, and reloading is precisely what would throw it away.
        </p>
      </div>

      <h3 className="mt-4 text-sm font-medium">If a strip appears above the page</h3>
      <p className="mt-1 text-sm text-text-2">
        None of these stop jojo working — what is on screen is real, and can still be read and
        exported. A strip rather than a toast, because a message saying your changes are not being
        saved must not scroll away after four seconds.
      </p>
      <dl className="mt-2 divide-y divide-hairline text-sm">
        {BANNERS.map((banner) => (
          <div key={banner.says} className="flex flex-wrap gap-x-3 gap-y-1 py-2.5">
            <dt className="basis-56 font-medium">&ldquo;{banner.says}&rdquo;</dt>
            <dd className="min-w-0 flex-1 basis-64 text-text-2">{banner.means}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-sm text-text-2">
        There is one more you should not have to see. If the database is there and cannot be read,
        jojo shows a recovery screen <span className="text-text-1">instead of</span> the app —
        nothing is mounted that could write over what is still on disk, and it never quietly starts
        again from scratch. It offers three things in the order they cost you something: download
        the rows it did manage to read, try again, or start fresh, which is the only one that asks
        first.
      </p>

      <h3 className="mt-4 text-sm font-medium">The controls in Settings</h3>
      <dl className="mt-2 divide-y divide-hairline text-sm">
        <div className="flex flex-wrap gap-x-3 gap-y-1 py-2.5">
          <dt className="basis-44 font-medium">Export a backup</dt>
          <dd className="min-w-0 flex-1 basis-64 text-text-2">
            Everything, in one versioned file: applications, timeline, vault, saved postings, your
            keywords and their tags, and your profile. It is written as{' '}
            <span className="text-text-1">jojo-backup-YYYY-MM-DD.json</span>, dated so a second
            export does not overwrite the first. It is a copy taken at the moment you press it — it
            does not keep up with what you do next, and it is the only copy of your data that is not
            on this machine. Export to Excel and Import are switched off and say why when you hover
            them.
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 py-2.5">
          <dt className="basis-44 font-medium">Load demo data</dt>
          <dd className="min-w-0 flex-1 basis-64 text-text-2">
            Replaces what is there rather than merging into it. Worth pressing on an empty store to
            see what a filled one looks like; worth exporting first otherwise.
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 py-2.5">
          <dt className="basis-44 font-medium">Clear every record</dt>
          <dd className="min-w-0 flex-1 basis-64 text-text-2">
            Applications, timeline, vault, saved postings and your profile.{' '}
            <span className="text-text-1">Your keywords are kept</span> — they are records of their
            own and you named them — so every count in the keyword panel goes to zero rather than
            the list going empty.
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 py-2.5 last:pb-0">
          <dt className="basis-44 font-medium">Clear browser storage</dt>
          <dd className="min-w-0 flex-1 basis-64 text-text-2">
            Everything this site has put in your browser — the records and their database, your
            theme and sound settings, caches and cookies — then a reload. jojo comes back the way it
            would on a new machine, first-run question and all. There is no server holding a copy,
            so this really is all of it.
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-sm text-text-2">
        Those last three are the only writes <Kbd>⌘Z</Kbd> will not take back, which is why each one
        asks first and says exactly what it reaches. They still appear in the audit log.{' '}
        <span className="text-text-1">Diagnostics</span>, on the same page, counts what is in your
        store, how much room the browser is giving jojo, and names anything it refused to read.
      </p>

      <h3 className="mt-4 text-sm font-medium">Moving to another machine</h3>
      <p className="mt-1 text-sm text-text-2">
        <Go to={transferPath()}>Transfer</Go> is the screen for handing your records to a second
        device: pick a direction, read the pairing code, see exactly what would go and how much of
        it, and choose whether documents come along.{' '}
        <span className="text-text-1">
          Nothing is transmitted in this build — it opens no connection and writes nothing.
        </span>{' '}
        It is worth walking through because it is shaped like the real handoff and the counts on it
        are read from your actual store, but the way to move your data today is the export above.
      </p>
    </Panel>
  )
}

export function BrowserIsTheDatabase() {
  return (
    <Panel className="border-warning-border">
      <div className="flex gap-3">
        <ShieldAlert
          className="mt-0.5 size-5 shrink-0 text-warning"
          strokeWidth={1.7}
          aria-hidden
        />
        <div>
          <h2 className="text-base font-medium">Your browser is the database</h2>
          {/* The heading was already true and the paragraph under it denied
              it: "this build keeps everything in memory for the session, so a
              reload starts from the demo data again". Records go to IndexedDB
              as you work now, so what is left to warn about is the thing that
              is still true — the database is on this one machine, nothing
              syncs it anywhere, and a browser can clear it. */}
          <p className="mt-1.5 text-sm text-text-2">
            Every record is written to the database inside this browser as you work, so closing the
            tab is safe. Nothing leaves this machine and nothing syncs — clear your browser data,
            switch browsers or lose the disk and it goes with them. Export a <Kbd>.json</Kbd> backup
            from <Go to={settingsPath()}>Settings</Go> for anything you want to keep elsewhere.
          </p>
        </div>
      </div>
    </Panel>
  )
}
