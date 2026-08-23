import { useState } from 'react'
import { View } from 'react-native'
import type { Thread } from '@jojo/service/react/use-threads'
import type { NodeId } from '@jojo/service/core/model'
import { displayName } from '@jojo/service/data/seed'
import type { Application } from '@jojo/service/data/seed'
import { ApplicationPickerSheet } from '@/components/common/ApplicationPickerSheet'
import { Button, IconButton } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { TextField } from '@/components/ui/Field'
import { Txt } from '@/components/ui/Text'
import { s } from '@/theme/styles'
import { space } from '@/theme/tokens'

/**
 * Which conversation you are in, and what it is about.
 *
 * A horizontally scrolling row of names rather than a drawer, matching the web
 * copy for the reason given there — a list that has to collapse is a second
 * thing to design and a second place for the current thread to be wrong. On a
 * phone the row IS the whole affordance, so it scrolls rather than wraps: a
 * growing list must not push the messages off the screen.
 *
 * Filing uses the same sheet a document uses, because it is the same act on the
 * same edge.
 */
export function ThreadBar({
  threads,
  activeId,
  byId,
  onBrowse,
  onRename,
  onFile,
  onDelete,
  onSetAuto,
  busy,
}: {
  threads: readonly Thread[]
  activeId: NodeId | null
  byId: ReadonlyMap<string, Application>
  /** Opens the list of conversations. */
  onBrowse: () => void
  onRename: (id: NodeId, title: string) => void
  onFile: (id: NodeId, applicationId: NodeId | null) => void
  onDelete: (id: NodeId) => void
  /** Turns "ask me before every change" off for this conversation. */
  onSetAuto: (id: NodeId, auto: boolean) => void
  busy: boolean
}) {
  const active = threads.find((t) => t.id === activeId) ?? null
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [filing, setFiling] = useState(false)

  const filedUnder = active?.applicationId ? byId.get(active.applicationId) : undefined

  return (
    <View style={{ gap: space[2] }}>
      {/* One row: which conversation is open, and the way into all of them.
          Moving between them is the sheet's job — the two questions are
          different, and one control answering both answered neither well past
          about three threads. */}
      <View style={[s.row, { gap: space[2] }]}>
        <Button
          label={active ? 'Conversations' : 'New conversation'}
          icon="message-square"
          variant="outline"
          disabled={busy}
          onPress={onBrowse}
        />
        {threads.length > 0 ? (
          <Txt size="xs" tone="muted" numberOfLines={1} style={s.fill}>
            {threads.length} kept
          </Txt>
        ) : null}
      </View>

      {active ? (
        editing ? (
          <View style={{ gap: space[2] }}>
            <TextField
              label="Conversation title"
              value={draft}
              autoFocus
              onChangeText={setDraft}
              onSubmitEditing={() => {
                onRename(active.id, draft)
                setEditing(false)
              }}
            />
            <View style={[s.row, { justifyContent: 'flex-end', gap: space[2] }]}>
              <Button label="Cancel" variant="ghost" onPress={() => setEditing(false)} />
              <Button
                label="Save"
                onPress={() => {
                  onRename(active.id, draft)
                  setEditing(false)
                }}
              />
            </View>
          </View>
        ) : (
          <View style={[s.row, { gap: space[2] }]}>
            <Txt size="sm" weight="medium" numberOfLines={1} style={s.fill}>
              {active.title}
            </Txt>
            <IconButton
              icon="edit-3"
              label="Rename this conversation"
              onPress={() => {
                setDraft(active.title)
                setEditing(true)
              }}
            />
            <IconButton
              icon="briefcase"
              label={filedUnder ? 'Change the job this is about' : 'File under a job'}
              active={Boolean(filedUnder)}
              onPress={() => setFiling(true)}
            />
            {/* Per conversation, not per app: the granularity people want is
                "this one is a cleanup session, stop asking me". Absent means
                ask, because the safe default has to be the one you get without
                choosing. */}
            <IconButton
              icon={active.autoApprove ? 'zap' : 'shield'}
              label={
                active.autoApprove
                  ? 'Acting without asking — tap to ask before each change'
                  : 'Asking before each change — tap to act without asking'
              }
              onPress={() => {
                onSetAuto(active.id, !active.autoApprove)
              }}
            />
            <IconButton
              icon="trash-2"
              label="Delete this conversation"
              tone="danger"
              disabled={busy}
              onPress={() => {
                onDelete(active.id)
              }}
            />
          </View>
        )
      ) : null}

      {filedUnder ? <Chip tone="teal">{displayName(filedUnder)}</Chip> : null}

      {/* A conversation is about one job, so the multi-select is handed a list
          of one and its last choice is taken. The relation allows many — it is
          the same `FILED_UNDER` a document uses — and if a thread ever needs to
          span two, only this call site changes. */}
      <ApplicationPickerSheet
        open={filing}
        values={active?.applicationId ? [active.applicationId] : []}
        onClose={() => setFiling(false)}
        onChange={(ids) => {
          if (active) onFile(active.id, ids.at(-1) ?? null)
          setFiling(false)
        }}
      />
    </View>
  )
}
