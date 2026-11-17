import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { RotateCcw } from 'lucide-react'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { useGraph, useKg } from '@jojo/service/react/kg-context'
import type { JournalEntry } from '@jojo/service/repo/journal'
import { useToast } from '@/lib/toast-context'

/**
 * Every write this store has recorded, newest first, and an undo on the newest.
 *
 * The rows are not a debugging luxury: the journal is persisted (capped at 200,
 * pruned on open), so this is the answer the first time someone says a record
 * changed by itself. Before it existed the honest answer was "there is no way to
 * know" — the store was a reducer, and what it had done was gone the moment it
 * had done it.
 *
 * Undo on the top row only. `repo.revert` can replay any entry in the ring, and
 * offering that per row would read as a time machine it is not: an entry from
 * three hours ago holds before-images captured against records that have been
 * edited a dozen times since, so replaying one puts a stale version back over
 * every change made in between. Reverting the newest is the one case where the
 * before-image is still a description of the present.
 */

/**
 * The two writes with no meaningful inverse.
 *
 * Both are declared `undoable: false` (both tools in `kg/tools/memory.ts`) and both go
 * through a confirmation rather than an undo toast. The runtime enforces that on
 * the undo STACK, not on the journal, so they are in the audit like everything
 * else and `revert` would happily replay one — putting back the whole store as
 * a single entry, from a dialog that had told the user there was no undo.
 */
const NO_UNDO: readonly string[] = ['memory.reset', 'memory.clear']

/** How many rows before the list gets a "show everything" of its own. */
const FIRST_PAGE = 8

const touchedBy = (entry: JournalEntry, t: TFunction<'settings'>): string => {
  const records = entry.nodes.length
  const links = entry.edges.length
  // An entry that changed nothing is still recorded — "you pressed save and
  // nothing happened" is worth being able to see — so it needs a word too.
  if (records === 0 && links === 0) return t('audit.noChange')
  if (links === 0) return t('audit.records', { count: records })
  if (records === 0) return t('audit.connections', { count: links })
  return t('audit.both', {
    records: t('audit.records', { count: records }),
    connections: t('audit.connections', { count: links }),
  })
}

/** In the language jojo is showing, not the browser's. */
const time = (instant: string, locale: string): string => {
  const parsed = new Date(instant)
  return Number.isNaN(parsed.getTime()) ? instant : parsed.toLocaleString(locale)
}

export function AuditLog() {
  const { t, i18n } = useTranslation('settings')
  const { repo } = useKg()
  const { toast } = useToast()
  const [all, setAll] = useState(false)
  // Read for its side effect on rendering, not for its value: the audit ring is
  // a plain getter on the repository and nothing re-renders when it grows. The
  // graph subscription ticks on exactly the same commits, so reading it here is
  // what keeps this list from showing a write the app has already applied.
  useGraph()

  const entries = repo.audit
  const shown = all ? entries : entries.slice(0, FIRST_PAGE)
  const top = entries[0]
  // `trimmed` as well as the tool: an entry whose record images were dropped
  // cannot be put back, and `revert` throws on one. That is reachable: a
  // background write (stack: false — a fit reading, a file's bytes) is always
  // trimmed, so the button is disabled whenever one is the newest row, as well
  // as for an entry too far back to have kept its images.
  const canUndo = top !== undefined && !NO_UNDO.includes(top.tool) && top.trimmed !== true
  // Said by case: the whole-store sentence on a trimmed row named the wrong
  // reason for the same disabled button.
  const undoTitle = canUndo
    ? t('audit.undoTitle.can')
    : top !== undefined && NO_UNDO.includes(top.tool)
      ? t('audit.undoTitle.wholeStore')
      : t('audit.undoTitle.trimmed')

  const onUndo = () => {
    if (!top) return
    try {
      const entry = repo.revert(top.id)
      toast({ title: entry.label })
    } catch (error) {
      // Reachable, and not a bug: another tab's commit clears the rings, so an
      // entry rendered a second ago may be gone by the time the button is
      // pressed. A thrown error out of a click handler would take the route
      // down with it through the boundary.
      toast({
        title: t('audit.undoFailed.title'),
        description: error instanceof Error ? error.message : t('audit.undoFailed.description'),
        tone: 'danger',
      })
    }
  }

  return (
    <Panel>
      <PanelTitle hint={t('audit.kept', { count: entries.length })}>{t('audit.title')}</PanelTitle>

      {entries.length === 0 ? (
        <p className="text-sm text-text-2">{t('audit.empty')}</p>
      ) : (
        <>
          <div className="divide-y divide-hairline">
            {shown.map((entry, index) => (
              <div key={entry.id} className="flex items-start justify-between gap-4 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm text-text-1">{entry.label}</div>
                  <div className="mt-0.5 text-xs text-text-3">
                    {time(entry.at, i18n.language)} · {touchedBy(entry, t)} ·{' '}
                    <span className="font-mono">{entry.tool}</span>
                  </div>
                </div>
                {index === 0 ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={onUndo}
                    disabled={!canUndo}
                    title={undoTitle}
                  >
                    <RotateCcw className="size-3.5" strokeWidth={1.8} aria-hidden />
                    {t('shared.undo')}
                  </Button>
                ) : null}
              </div>
            ))}
          </div>

          {entries.length > FIRST_PAGE ? (
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => setAll(!all)}>
              {all ? t('audit.showFewer') : t('audit.showAll', { total: entries.length })}
            </Button>
          ) : null}

          <p className="mt-3 text-xs text-text-3">{t('audit.footer')}</p>
        </>
      )}
    </Panel>
  )
}
