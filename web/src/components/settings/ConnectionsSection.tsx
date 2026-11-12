import { McpLinkPanel } from '@/components/settings/McpLinkPanel'
import { LocalModelPanel } from '@/components/settings/LocalModelPanel'
import { DocumentReaderPanel } from '@/components/settings/DocumentReaderPanel'

/**
 * Where the user's documents are, and the one thing jojo can talk to outside
 * itself: a local model.
 *
 * Both halves are real now. This comment used to except "the folder switches
 * below", which were three `useState` values with no reader, sitting under a
 * picker that bound a directory nothing ever wrote a document to. All of it is
 * gone — see `DocumentsPanel`, which says where documents actually live and
 * offers the way to get them out.
 */
export function ConnectionsSection() {
  /*
   * Two cards, and the pairing is the organisation.
   *
   * There were three, and the third was `DocumentsPanel` — which is not a
   * connection at all: it reports how many documents are in this browser and
   * offers to download them, which is a fact about storage. In a two-column grid
   * that made an odd number, so "Read my documents" was orphaned on the left
   * with an empty half-row beside it and a tall gap under the short card. It has
   * moved next to `DataPanel`, where the rest of "where your records live" is.
   *
   * What is left belongs together by shape as well as by subject: both are a
   * local service you point at, both take an address, and both have a Test
   * connection that says the same three things. Side by side they read as one
   * question asked twice.
   */
  return (
    <div className="grid grid-cols-1 items-start gap-4 sm:gap-5 lg:grid-cols-2">
      <LocalModelPanel />
      <DocumentReaderPanel />
      {/* Full width rather than a third half-card: an odd card in this grid is
          the orphan the paragraph above describes. It is also the other
          question — not "what does jojo talk to" but "what may talk to jojo". */}
      <div className="lg:col-span-2">
        <McpLinkPanel />
      </div>
    </div>
  )
}
