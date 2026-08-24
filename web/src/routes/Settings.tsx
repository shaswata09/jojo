import { TriangleAlert } from 'lucide-react'
import { AuditLog } from '@/components/settings/AuditLog'
import { Diagnostics } from '@/components/settings/Diagnostics'
import { KeywordManager } from '@/components/settings/KeywordManager'
import { PageHeader } from '@/components/common/PageHeader'
import { AppearancePanel } from '@/components/settings/AppearancePanel'
import { CrashPanel } from '@/components/settings/CrashPanel'
import { CaptureExtensionPanel } from '@/components/settings/CaptureExtensionPanel'
import { ConnectionsSection } from '@/components/settings/ConnectionsSection'
import { DataPanel } from '@/components/settings/DataPanel'
import { DocumentsPanel } from '@/components/settings/DocumentsPanel'
import { useTitle } from '@/lib/links'
import { isStorageAvailable } from '@/lib/storage'

export function Settings() {
  useTitle('Settings')

  // Reported, not assumed. jojo is local-first, so this is load-bearing.
  const storageOk = isStorageAvailable()

  return (
    <>
      <PageHeader title="Settings" subtitle="Connections, sync and your data" />

      {/* Two different questions, and they used to be conflated. This one is
          about `localStorage`, which holds the theme and the sound switch; the
          records live in IndexedDB, whose state is the banner at the top of every
          page and the Diagnostics panel below. The old copy said "nothing in this
          build depends on it yet — the store is in memory either way", which
          stopped being true the moment the store went to disk. */}
      {!storageOk ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-warning-border bg-warning-soft px-4 py-3 text-sm text-warning"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.8} aria-hidden />
          <p>
            This browser is blocking site storage, so your theme and sound preferences are not
            remembered between visits. Private windows and some managed browsers do this. Whether
            your records are being saved is a separate question — Diagnostics below answers it.
          </p>
        </div>
      ) : null}

      {/* The two local services: a model and a document reader. Both take an
          address and both have a Test connection, so they sit side by side. */}
      <ConnectionsSection />

      {/* Beside Connections rather than under Data: both are about something
          outside jojo that it talks to, and this one has an install state the
          user may need to check. */}
      <CaptureExtensionPanel />

      <AppearancePanel />

      {/* Where the records are, and where the documents are — the same question
          twice, so they are adjacent. `DocumentsPanel` used to sit up in
          Connections, which made an odd third card there and answered a question
          nobody was asking at that point on the page. */}
      <DataPanel />

      <DocumentsPanel />

      <KeywordManager />

      {/* Above Diagnostics: a crash report is the thing somebody came here to
          find, and Diagnostics is where they end up looking for it. */}
      <CrashPanel />

      <Diagnostics />

      <AuditLog />
    </>
  )
}
