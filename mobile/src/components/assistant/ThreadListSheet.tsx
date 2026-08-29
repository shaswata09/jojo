import { useMemo, useState } from 'react'
import { Pressable, View } from 'react-native'
import type { Thread } from '@jojo/service/react/use-threads'
import type { NodeId } from '@jojo/service/core/model'
import { agoLabel } from '@jojo/service/core/dates'
import { dayOf } from '@jojo/service/core/project'
import { useBusyThreads } from '@jojo/service/react/agent-runs-context'
import { displayName } from '@jojo/service/data/seed'
import type { Application } from '@jojo/service/data/seed'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { Sheet } from '@/components/ui/Sheet'
import { Txt } from '@/components/ui/Text'
import { TODAY } from '@/lib/today'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { radius, space } from '@/theme/tokens'

/**
 * Every conversation, to move between.
 *
 * A sheet rather than the web's left column, because a phone has no left column
 * — but the same list, grouped the same way and for the same reason. A person
 * keeps one conversation per job, so past the third the question stops being
 * "which of these is open" and becomes "which of these was about Rice". The
 * heading answers that; a truncated title cannot.
 *
 * Sorted inside a group by `useThreads`' own order, which is newest first.
 */
const FILTER_FROM = 6

export function ThreadListSheet({
  open,
  threads,
  activeId,
  byId,
  onOpen,
  onNew,
  onClose,
}: {
  open: boolean
  threads: readonly Thread[]
  activeId: NodeId | null
  byId: ReadonlyMap<string, Application>
  onOpen: (id: NodeId) => void
  onNew: () => void
  onClose: () => void
}) {
  const c = useColors()
  const [filter, setFilter] = useState('')

  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    const nameOf = (t: Thread) => {
      const app = t.applicationId ? byId.get(t.applicationId) : undefined
      return app ? displayName(app) : ''
    }
    const matching = needle
      ? threads.filter(
          (t) => t.title.toLowerCase().includes(needle) || nameOf(t).toLowerCase().includes(needle),
        )
      : threads
    const by = new Map<string, { label: string; threads: Thread[] }>()
    for (const t of matching) {
      const label = nameOf(t)
      // Unfiled last, under a heading naming what they have in common rather
      // than what they lack.
      const key = label || '￿'
      const group = by.get(key) ?? { label: label || 'Not about a job yet', threads: [] }
      group.threads.push(t)
      by.set(key, group)
    }
    return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, g]) => g)
  }, [byId, filter, threads])

  const busyThreads = useBusyThreads()

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="tall"
      title="Conversations"
      description={
        threads.length === 0
          ? 'Nothing yet — ask something and it is kept here, on this device.'
          : `${String(threads.length)} kept on this device.`
      }
      footer={
        <>
          <Button
            label="New conversation"
            icon="plus"
            variant="outline"
            onPress={() => {
              onNew()
              onClose()
            }}
          />
          <Button label="Done" onPress={onClose} />
        </>
      }
    >
      <View style={{ gap: space[4] }}>
        {threads.length >= FILTER_FROM ? (
          <TextField
            label="Filter"
            value={filter}
            placeholder="By name or job"
            autoCapitalize="none"
            onChangeText={setFilter}
          />
        ) : null}

        {groups.length === 0 && threads.length > 0 ? (
          <Txt size="sm" tone="muted">
            No conversation matches that.
          </Txt>
        ) : null}

        {groups.map((group) => (
          <View key={group.label} style={{ gap: space[2] }}>
            <Txt size="xs" tone="muted" weight="medium" numberOfLines={1}>
              {group.label}
            </Txt>
            {group.threads.map((t) => {
              const asked = t.entries.filter((e) => e.kind === 'you').length
              const on = t.id === activeId
              return (
                <Pressable
                  key={t.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`Open ${t.title}`}
                  onPress={() => {
                    onOpen(t.id)
                    onClose()
                  }}
                  style={{
                    padding: space[3],
                    borderRadius: radius.lg,
                    borderWidth: 1,
                    borderColor: on ? c.accent : c.hairline,
                    backgroundColor: on ? c.accentSoft : 'transparent',
                    gap: space[1],
                  }}
                >
                  {/* Two lines then an ellipsis: a title is the first thing the
                      person typed, and one line of it is often the word
                      "Which". */}
                  <Txt size="sm" numberOfLines={2}>
                    {t.title}
                  </Txt>
                  <View style={[s.row, { gap: space[2] }]}>
                    {/* A conversation can be working while you read another
                        one, so the row is the only place that fact can live. */}
                    {busyThreads.includes(t.id) ? (
                      <Txt size="xs" tone="accent">
                        Working…
                      </Txt>
                    ) : (
                      <>
                        <Txt size="xs" tone="muted">
                          {asked} {asked === 1 ? 'question' : 'questions'}
                        </Txt>
                        <Txt size="xs" tone="muted">
                          {/* `dayOf`, not `.slice(0, 10)` — the same repair as
                              `web`'s ThreadList, which this row is the twin of.
                              `updatedAt` is an instant and slicing takes the UTC
                              day out of it, while `TODAY` is the LOCAL day, so
                              the two compared days came from different
                              calendars. Measured in America/Chicago at 23:30
                              local: a thread touched seconds earlier sliced to
                              the 13th against a TODAY of the 12th, and
                              `agoLabel` printed "Oct 13" — a future date — on a
                              row that should have said "today". East of UTC the
                              same pair reads "yesterday". */}
                          · {agoLabel(dayOf(t.updatedAt), TODAY)}
                        </Txt>
                      </>
                    )}
                  </View>
                </Pressable>
              )
            })}
          </View>
        ))}
      </View>
    </Sheet>
  )
}
