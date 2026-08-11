import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Panel, PanelTitle } from '@/components/common/Panel'
import type { NodeType } from '@/kg/core/model'
import { useGraph, useKg } from '@/kg/react/kg-context'
import { useStoreStatus } from '@/kg/react/status-context'
import { SCHEMA_VERSION } from '@/kg/repo/meta'
import type { DataSet } from '@/kg/repo/meta'
import { estimateStorage, isStoragePersisted } from '@/kg/storage/probe'
import type { StorageEstimate } from '@/kg/storage/probe'
import { sessionOf, useBoot } from '@/lib/boot-context'

/**
 * What the store actually is, rather than what the app hopes it is.
 *
 * Every number here is read from the thing it describes. The counts come out of
 * the snapshot, the schema version out of the meta row that was on disk, the
 * skipped records out of the boot that skipped them. The panel exists because
 * local-first means this browser holds the only copy: when someone says a record
 * vanished, the alternative to this screen is asking them to open devtools.
 *
 * R-1(d) is the row that matters most. A validator that rejects a record and
 * drops it quietly is silent data loss, so every rejection is counted here and
 * named with its id — "12 records could not be read" on a screen is what turns
 * that from a mystery into a bug report.
 */

/**
 * Typed as a total map on purpose (R-12's pattern, `graph.ts:96-108`).
 *
 * A new node type then fails to compile here rather than rendering its raw
 * identifier in a settings panel, which is how `pipeline` would have shown up as
 * "pipeline" next to "Saved posting" and stayed that way.
 */
const TYPE_LABEL: Record<NodeType, string> = {
  application: 'Applications',
  organisation: 'Organisations',
  timelineItem: 'Timeline items',
  keyword: 'Keywords',
  link: 'Links',
  file: 'Files',
  snippet: 'Snippets',
  posting: 'Saved postings',
  match: 'Scout matches',
  pipeline: 'Scout pipelines',
  profile: 'Profile',
}

const DATA_SET_LABEL: Record<DataSet, string> = {
  demo: 'the demo records, untouched',
  empty: 'emptied on purpose, never seeded',
  user: 'written to since it was set up',
}

const NUMBER = new Intl.NumberFormat()

/** Bytes as the browser reports them: MB to one decimal, because quotas are big. */
function bytes(value: number | null): string {
  if (value === null) return 'not reported'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} kB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

/** An ISO instant as a local date and time, or a dash when there is not one. */
function at(instant: string | null | undefined): string {
  if (!instant) return '—'
  const parsed = new Date(instant)
  return Number.isNaN(parsed.getTime()) ? instant : parsed.toLocaleString()
}

function Line({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-hairline py-1.5 first:border-t-0">
      <span className="text-xs text-text-3">{label}</span>
      <span className="min-w-0 truncate text-right text-xs text-text-2">{value}</span>
    </div>
  )
}

export function Diagnostics() {
  const { state } = useBoot()
  const { health } = useStoreStatus()
  const { repo } = useKg()
  const graph = useGraph()
  const session = sessionOf(state)

  /**
   * Asked once when the panel opens, never at boot.
   *
   * `persisted()` is a read and safe anywhere, but `estimate()` is a
   * quota-manager call that costs real time on a large origin, and neither
   * belongs on the path between mount and first paint. They are also the two
   * values most likely to be stale by the time anyone reads them, which is why
   * they are fetched here rather than carried down from `boot`.
   */
  const [persisted, setPersisted] = useState<boolean | null | 'asking'>('asking')
  const [estimate, setEstimate] = useState<StorageEstimate | null | 'asking'>('asking')

  useEffect(() => {
    let live = true
    void isStoragePersisted().then((value) => {
      if (live) setPersisted(value)
    })
    void estimateStorage().then((value) => {
      if (live) setEstimate(value)
    })
    return () => {
      live = false
    }
  }, [])

  const counts = new Map<NodeType, number>()
  for (const node of graph.nodes()) counts.set(node.type, (counts.get(node.type) ?? 0) + 1)
  const rels = new Map<string, number>()
  for (const edge of graph.edges()) rels.set(edge.rel, (rels.get(edge.rel) ?? 0) + 1)
  const edgeCount = [...rels.values()].reduce((sum, n) => sum + n, 0)

  const lastWrite = repo.audit[0]
  const meta = session?.meta

  return (
    <Panel>
      <PanelTitle hint="this browser only">Diagnostics</PanelTitle>

      <div className="grid grid-cols-1 gap-x-8 gap-y-5 lg:grid-cols-2">
        <div>
          <h3 className="mb-1.5 text-xs font-medium text-text-2">Storage</h3>
          <Line
            label="Records are written to disk"
            value={session?.durable ? 'yes — IndexedDB' : 'no — this tab only'}
          />
          <Line
            label="Database schema"
            value={`v${meta?.schemaVersion ?? '—'} (app expects v${SCHEMA_VERSION})`}
          />
          {/*
           * Three states, and "not reported" is not "no". R-6: Safari evicts an
           * origin after seven days without a visit and there is no API that
           * prevents it — only `persist()`, which asks. Printing "no" on a
           * browser that simply has no Storage API would be inventing a threat
           * this code cannot back up.
           */}
          <Line
            label="Browser promises to keep it"
            value={
              persisted === 'asking'
                ? 'checking…'
                : persisted === null
                  ? 'this browser will not say'
                  : persisted
                    ? 'yes'
                    : // Deliberately not "after 7 days": that is Safari's
                      // eviction window and reads as a floor, which it is not.
                      // A Chrome private window reports exactly this — `persist()`
                      // resolves false — and discards the whole store when the
                      // window closes, minutes later. Chrome exposes no bit for
                      // private browsing, so this line cannot detect that case;
                      // what it can do is stop implying a week of safety it has
                      // no way to check.
                      'no — the browser may clear it at any time, and a private window will when it closes'
            }
          />
          <Line
            label="Space used"
            value={
              estimate === 'asking'
                ? 'checking…'
                : estimate === null
                  ? 'not reported'
                  : `${bytes(estimate.usage)} of ${bytes(estimate.quota)}`
            }
          />
          <Line
            label="Write queue"
            value={
              health.state === 'idle'
                ? 'idle — everything is saved'
                : health.state === 'writing'
                  ? `saving ${health.pending} change${health.pending === 1 ? '' : 's'}`
                  : health.state === 'degraded'
                    ? `retrying ${health.unsaved} change(s), ${health.pending} row(s) (attempt ${health.attempts}): ${health.lastError}`
                    : `stopped — ${health.reason}`
            }
          />
        </div>

        <div>
          <h3 className="mb-1.5 text-xs font-medium text-text-2">This store</h3>
          {/*
           * Spelled out rather than printed raw, because the raw value reads as
           * the wrong claim. `dataSet` flips to 'user' on the FIRST write of any
           * kind (`meta.ts:109`) — including the write that loads the demo data —
           * so a row saying "user" a second after pressing Demo data would look
           * like the panel had lost track of what is in the store. What the field
           * actually records is whether anything has been written since it was
           * seeded, which is what decides whether a reseed is ever on the table.
           */}
          <Line label="Contents" value={meta ? DATA_SET_LABEL[meta.dataSet] : '—'} />
          <Line label="Created" value={at(meta?.createdAt)} />
          <Line label="Seeded" value={meta?.seededAt ? at(meta.seededAt) : 'never'} />
          <Line label="Last opened" value={at(meta?.lastOpenedAt)} />
          <Line
            label="Last write"
            value={lastWrite ? `${lastWrite.label} · ${at(lastWrite.at)}` : 'nothing yet'}
          />
          {/*
           * Named, not just counted. A skipped record is a row that is on disk
           * and not on screen, and the id is the only thing that makes it
           * findable again.
           */}
          <Line
            label="Records skipped as corrupt"
            value={
              session && session.skipped.length > 0
                ? `${session.skipped.length} — ${session.skipped.map((d) => d.id).join(', ')}`
                : 'none'
            }
          />
          <Line
            label="Integrity checks"
            value={
              session && session.problems.length > 0
                ? `${session.problems.length} failed`
                : 'all passed'
            }
          />
        </div>

        <div>
          <h3 className="mb-1.5 text-xs font-medium text-text-2">
            Records ({NUMBER.format(graph.nodes().length)})
          </h3>
          {(Object.keys(TYPE_LABEL) as NodeType[]).map((type) => (
            <Line
              key={type}
              label={TYPE_LABEL[type]}
              value={NUMBER.format(counts.get(type) ?? 0)}
            />
          ))}
        </div>

        <div>
          <h3 className="mb-1.5 text-xs font-medium text-text-2">
            Connections ({NUMBER.format(edgeCount)})
          </h3>
          {rels.size === 0 ? (
            <Line label="None" value="0" />
          ) : (
            [...rels.entries()].map(([rel, count]) => (
              <Line key={rel} label={rel} value={NUMBER.format(count)} />
            ))
          )}
        </div>
      </div>

      {session && session.problems.length > 0 ? (
        <pre className="mt-4 max-h-32 overflow-auto rounded-sm bg-well p-3 font-mono text-xs text-text-3">
          {session.problems.join('\n')}
        </pre>
      ) : null}

      {/* The note that used to sit here said these times came from a date the
          build pinned rather than from the reader's clock. That was true through
          Wave 3 and stopped being true in Wave 4: the store takes the wall clock
          now and the demo records are shifted to meet it, so a line explaining
          why the timestamps disagree with the calendar would be explaining a
          discrepancy that is no longer there. */}
    </Panel>
  )
}
