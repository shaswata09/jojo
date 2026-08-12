import { useState } from 'react'
import { View } from 'react-native'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Divider, Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { useGraph, useKg } from '@/kg/react/kg-context'
import type { JournalEntry } from '@/kg/repo/journal'
import { useToast } from '@/lib/toast-context'
import { s } from '@/theme/styles'
import { space } from '@/theme/tokens'

/**
 * Every write this store has recorded, newest first, and an undo on the newest.
 *
 * Not a debugging luxury. The journal is on the device now and pruned on open,
 * so this is the answer the first time someone says a record changed by itself.
 * Before the graph store landed here the honest answer was "there is no way to
 * know" — the store was a reducer, and what it had done was gone the moment it
 * had done it.
 *
 * **Undo on the top row only.** `repo.revert` can replay any entry in the ring,
 * and offering that per row would read as a time machine it is not: an entry
 * from three hours ago holds before-images captured against records that have
 * been edited a dozen times since, so replaying one puts a stale version back
 * over every change made in between. Reverting the newest is the one case where
 * the before-image is still a description of the present.
 */

/** Reverting either of these would restore the data set the user just replaced. */
const NO_UNDO: readonly string[] = ['memory.reset', 'memory.clear']

/** How many rows before the list gets a "show everything" of its own. */
const FIRST_PAGE = 8

const touchedBy = (entry: JournalEntry): string => {
  const records = entry.nodes.length
  const links = entry.edges.length
  const parts: string[] = []
  if (records > 0) parts.push(`${records} record${records === 1 ? '' : 's'}`)
  if (links > 0) parts.push(`${links} link${links === 1 ? '' : 's'}`)
  return parts.join(' · ')
}

/** 'HH:MM', local. The date is almost always today and would be noise on every row. */
const timeOf = (iso: string) => {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function AuditLog() {
  const { repo } = useKg()
  const { toast } = useToast()
  const [all, setAll] = useState(false)
  // Read for its effect on rendering, not for its value: the audit ring is a
  // plain getter and nothing re-renders when it grows. The graph subscription
  // ticks on exactly the same commits, so reading it here is what keeps this
  // list from being one write behind the app.
  useGraph()

  const entries = repo.audit
  const shown = all ? entries : entries.slice(0, FIRST_PAGE)
  const top = entries[0]
  const canUndo = top !== undefined && !NO_UNDO.includes(top.tool)

  const onUndo = () => {
    if (!top) return
    try {
      const entry = repo.revert(top.id)
      toast({ title: entry.label })
    } catch (error) {
      // Reachable and not a bug: the ring is pruned, so an entry rendered a
      // second ago can be gone by the time the button is pressed. A throw out
      // of a press handler would take the screen down with it.
      toast({
        title: 'That change could no longer be undone',
        description: error instanceof Error ? error.message : 'It is no longer in the journal.',
        tone: 'danger',
      })
    }
  }

  return (
    <Panel>
      <PanelTitle hint={entries.length > 0 ? `${entries.length} recorded` : undefined}>
        What changed
      </PanelTitle>

      {entries.length === 0 ? (
        <EmptyState
          icon="clock"
          title="Nothing written yet"
          description="Every add, edit and delete lands here as you make it — newest first, with the last one undoable."
          compact
        />
      ) : (
        <>
          <View style={[s.row, { marginBottom: space[3] }]}>
            <Txt size="xs" tone="muted" style={s.fill}>
              The newest change can be put back. Older ones are a record, not a time machine.
            </Txt>
            <Button
              label="Undo the last"
              icon="rotate-ccw"
              variant="outline"
              onPress={onUndo}
              disabled={!canUndo}
              blocker={
                top && !canUndo ? 'Loading or clearing the data set cannot be undone.' : undefined
              }
            />
          </View>

          {shown.map((entry, i) => (
            <View key={entry.id}>
              {i > 0 ? <Divider /> : null}
              <View style={{ paddingVertical: space[2.5] }}>
                <View style={s.row}>
                  <Txt size="sm" style={s.fill} numberOfLines={2}>
                    {entry.label}
                  </Txt>
                  <Txt size="xs" tone="muted" mono>
                    {timeOf(entry.at)}
                  </Txt>
                </View>
                <Txt size="xs" tone="muted" style={{ marginTop: 2 }}>
                  {/* The tool's own name, because it is what the journal and the
                      architecture document call it — someone who has read either
                      should find the same word here. */}
                  {entry.tool}
                  {touchedBy(entry) ? ` · ${touchedBy(entry)}` : ''}
                </Txt>
              </View>
            </View>
          ))}

          {!all && entries.length > FIRST_PAGE ? (
            <Button
              label={`Show all ${entries.length}`}
              variant="ghost"
              onPress={() => setAll(true)}
              style={{ alignSelf: 'flex-start', marginTop: space[2] }}
            />
          ) : null}
        </>
      )}
    </Panel>
  )
}
