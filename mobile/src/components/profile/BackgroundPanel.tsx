import { useMemo, useState } from 'react'
import { Pressable, View } from 'react-native'
import { Feather } from '@react-native-vector-icons/feather/static'
import { EmptyState } from '@/components/ui/EmptyState'
import { Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { Button } from '@/components/ui/Button'
import { FormField, TextField } from '@/components/ui/Field'
import { MenuSheet } from '@/components/ui/Menu'
import { Sheet } from '@/components/ui/Sheet'
import {
  addEntryFrom,
  draftOf,
  draftProblems,
  emptyDraft,
  updateFrom,
} from '@jojo/service/core/background-form'
import type { BackgroundDraft } from '@jojo/service/core/background-form'
import { BACKGROUND_LABEL, BACKGROUND_ORDER } from '@jojo/service/core/model'
import type { Background, BackgroundKind } from '@jojo/service/core/model'
import { readableDocuments } from '@jojo/service/core/twin'
import { useGraph, useKg } from '@jojo/service/react/kg-context'
import { requestProfileRead } from '@jojo/service/react/profile-read-request'
import { useRun } from '@jojo/service/react/use-tool'
import { useToast } from '@/lib/toast-context'
import { useModelSettings } from '@/lib/model-settings-context'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'

/**
 * What jojo knows about the person, grouped and listed.
 *
 * The phone's half of web's `profile/BackgroundPanel.tsx`. The reasoning is
 * there: the entries had nowhere to be seen and no way to be corrected, and a
 * wrong claim about somebody's career in their own records that they cannot
 * delete is worse than no record at all.
 *
 * ONE DIFFERENCE, and it is not cosmetic: deleting asks first. A trash icon
 * that appears on hover is a deliberate act with a pointer; the same icon under
 * a thumb on a scrolling list is not, and the Undo in a toast is easy to scroll
 * past on a phone. So this confirms and web does not.
 */

function Entry({
  entry,
  onEdit,
  onDelete,
}: {
  entry: Background
  onEdit: () => void
  onDelete: () => void
}) {
  const c = useColors()
  const [open, setOpen] = useState(false)
  const bullets = entry.highlights ?? []

  return (
    <View style={{ borderTopWidth: 1, borderTopColor: c.hairline, paddingVertical: space[2] }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[2] }}>
        <View style={{ flex: 1, gap: space[0.5] }}>
          <Txt size="sm">
            <Txt size="sm" weight="medium">
              {entry.title}
            </Txt>
            {entry.where === undefined ? '' : ` · ${entry.where}`}
            {entry.period === undefined ? '' : ` · ${entry.period}`}
          </Txt>
          {entry.detail !== undefined && (
            <Txt size="sm" tone="secondary">
              {entry.detail}
            </Txt>
          )}

          {bullets.length > 0 && (
            <>
              <Pressable
                onPress={() => setOpen((v) => !v)}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                hitSlop={8}
                style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }}
              >
                <Feather name={open ? 'chevron-up' : 'chevron-down'} size={13} color={c.text3} />
                <Txt size="xs" tone="muted">
                  {bullets.length === 1 ? '1 detail' : `${String(bullets.length)} details`}
                </Txt>
              </Pressable>
              {open && (
                <View style={{ gap: space[0.5], paddingLeft: space[3] }}>
                  {bullets.map((b) => (
                    <Txt key={b} size="sm" tone="secondary">
                      • {b}
                    </Txt>
                  ))}
                </View>
              )}
            </>
          )}

          {entry.source !== undefined && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }}>
              <Feather name="file-text" size={11} color={c.text3} />
              <Txt size="xs" tone="muted">
                read from a document
              </Txt>
            </View>
          )}
        </View>

        {/* Edit beside remove. Correcting a wrong reading is the commoner act,
            and it used to be a delete and a retype — on a phone, of six bullets. */}
        <View style={{ flexDirection: 'row', gap: space[3], paddingTop: 2 }}>
          <Pressable
            onPress={onEdit}
            accessibilityRole="button"
            accessibilityLabel={`Edit ${entry.title}`}
            hitSlop={10}
          >
            <Feather name="edit-2" size={16} color={c.text3} />
          </Pressable>
          <Pressable
            onPress={onDelete}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${entry.title}`}
            hitSlop={10}
          >
            <Feather name="trash-2" size={16} color={c.text3} />
          </Pressable>
        </View>
      </View>
    </View>
  )
}

/**
 * The sheet for adding an entry and for editing one — the same sheet, so the
 * two cannot drift. The decisions in it (a blank box on an edit takes the
 * field off; only what changed is sent; a bad year is refused with a sentence)
 * are `core/background-form.ts`, shared with the web. Save is disabled until
 * something changed, because a Save that wrote nothing would raise an Undo for
 * nothing. Keyed by the caller so opening a different entry starts fresh.
 */
function EntrySheet({
  initial,
  open,
  onClose,
}: {
  /** `null` for a new entry. */
  initial: Background | null
  open: boolean
  onClose: () => void
}) {
  const run = useRun()
  const { toast } = useToast()
  const [draft, setDraft] = useState<BackgroundDraft>(() =>
    initial === null ? emptyDraft() : draftOf(initial),
  )
  const [tried, setTried] = useState(false)
  const [kindOpen, setKindOpen] = useState(false)
  const problems = draftProblems(draft)
  const patch = initial === null ? null : updateFrom(initial, draft)
  const blocked = Object.keys(problems).length > 0 || (initial !== null && patch === null)
  const editing = initial !== null

  const save = () => {
    setTried(true)
    if (Object.keys(problems).length > 0) return
    if (initial === null) {
      const entry = addEntryFrom(draft)
      const result = run('profile.background.add', { background: [entry] })
      toast({
        title: result.ok ? `${entry.title} added` : 'That did not save',
        ...(result.ok
          ? result.undo
            ? { action: { label: 'Undo', onPress: result.undo } }
            : {}
          : { description: result.errors[0]?.message, tone: 'danger' as const }),
      })
      if (result.ok) onClose()
      return
    }
    if (patch === null) {
      onClose()
      return
    }
    const result = run('profile.background.update', { id: initial.id, ...patch })
    toast({
      title: result.ok ? `${draft.title.trim() || initial.title} updated` : 'That did not save',
      ...(result.ok
        ? result.undo
          ? { action: { label: 'Undo', onPress: result.undo } }
          : {}
        : { description: result.errors[0]?.message, tone: 'danger' as const }),
    })
    if (result.ok) onClose()
  }

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={editing ? 'Edit this entry' : 'Add to your background'}
        description={
          editing
            ? initial.source !== undefined
              ? 'Read from a document. Your edit is kept over the reading.'
              : 'Nothing is saved until you press Save.'
            : 'Anything a posting should be weighed against. Nothing here is sent anywhere.'
        }
        footer={
          <>
            <Button label="Cancel" variant="ghost" size="md" onPress={onClose} />
            <Button label={editing ? 'Save' : 'Add'} size="md" disabled={blocked} onPress={save} />
          </>
        }
      >
        <View style={{ gap: space[2], paddingBottom: space[2] }}>
          {/* A menu rather than a picker wheel: sixteen kinds is a list to read,
              and `MenuSheet` is what every other choice on this phone uses. */}
          <FormField label="Kind">
            <Button
              label={BACKGROUND_LABEL[draft.kind]}
              variant="outline"
              size="md"
              onPress={() => setKindOpen(true)}
            />
          </FormField>
          <TextField
            label="Title"
            required
            value={draft.title}
            placeholder="What it was"
            {...(tried && problems.title ? { error: problems.title } : {})}
            onChangeText={(title) => setDraft({ ...draft, title })}
          />
          <TextField
            label="Where"
            value={draft.where}
            placeholder="Optional"
            onChangeText={(where) => setDraft({ ...draft, where })}
          />
          <TextField
            label="When"
            value={draft.period}
            placeholder="As written — “2021–2024”"
            onChangeText={(period) => setDraft({ ...draft, period })}
          />
          <TextField
            label="Year"
            value={draft.year}
            placeholder="2024"
            keyboardType="number-pad"
            maxLength={4}
            {...(tried && problems.year ? { error: problems.year } : {})}
            onChangeText={(year) => setDraft({ ...draft, year })}
          />
          <TextField
            label="Detail"
            value={draft.detail}
            multiline
            placeholder="Optional"
            onChangeText={(detail) => setDraft({ ...draft, detail })}
          />
          <TextField
            label="Highlights"
            hint="One per line — what was built, shipped, taught or found."
            value={draft.highlights}
            multiline
            placeholder="Optional"
            onChangeText={(highlights) => setDraft({ ...draft, highlights })}
          />
        </View>
      </Sheet>

      <MenuSheet
        open={kindOpen}
        onClose={() => setKindOpen(false)}
        title="Kind"
        description="Which part of your background this belongs to."
        actions={BACKGROUND_ORDER.map((kind) => ({
          id: kind,
          label: BACKGROUND_LABEL[kind],
          checked: kind === draft.kind,
          onPress: () => setDraft({ ...draft, kind }),
        }))}
      />
    </>
  )
}

export function BackgroundPanel() {
  const graph = useGraph()
  const { projections } = useKg()
  const run = useRun()
  const { toast } = useToast()
  const [confirming, setConfirming] = useState<Background | null>(null)

  const all = projections.background(graph)
  // See the web twin: the unbranched sentence promised a read that cannot
  // happen without a model, six inches above an upload button.
  const { settings } = useModelSettings()
  const configured = settings.model.trim() !== ''

  const groups = useMemo(() => {
    const by = new Map<BackgroundKind, Background[]>()
    for (const entry of all) {
      const held = by.get(entry.kind)
      if (held) held.push(entry)
      else by.set(entry.kind, [entry])
    }
    return BACKGROUND_ORDER.flatMap((kind) => {
      const rows = by.get(kind)
      return rows === undefined ? [] : [{ kind, rows }]
    })
  }, [all])

  /*
   * Adding a fact by hand, and correcting one — the phone had no route to
   * either. See web's `BackgroundPanel` for the argument. A sheet rather than
   * an inline form, because that is what this app does with every multi-field
   * edit on a phone, and because the keyboard covers half the screen the
   * moment the first field is focused.
   *
   * `'new'` or the entry being edited; keyed into the sheet so that opening a
   * different entry starts from that entry rather than from the last draft.
   */
  const [editing, setEditing] = useState<Background | 'new' | null>(null)
  const [choosing, setChoosing] = useState(false)
  // The phone's records carry `uri`, so the record itself answers "has bytes".
  const documents = useMemo(() => readableDocuments(graph), [graph])

  const remove = (entry: Background) => {
    const result = run('profile.background.delete', { id: entry.id })
    setConfirming(null)
    toast({
      title: result.ok ? `${entry.title} removed` : 'That did not save',
      /*
       * The undo the tool handed back, which was being thrown away.
       *
       * Every write in this app returns one and the web twin keeps it. Dropping
       * it here meant a mis-tap on a fact read out of somebody's own CV was
       * unrecoverable — and the confirmation sheet in front of it is not a
       * substitute, because the sheet is what people learn to tap through.
       */
      ...(result.ok
        ? result.undo
          ? { action: { label: 'Undo', onPress: result.undo } }
          : {}
        : { description: result.errors[0]?.message, tone: 'danger' as const }),
    })
  }

  return (
    <Panel>
      <PanelTitle
        hint={
          all.length === 0
            ? undefined
            : `${String(all.length)} recorded · what a posting is weighed against`
        }
      >
        Your background
      </PanelTitle>

      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'flex-end',
          gap: space[2],
          marginBottom: space[2],
        }}
      >
        <Button
          label="Read a document"
          icon="zap"
          variant="outline"
          size="sm"
          disabled={!configured}
          onPress={() => setChoosing(true)}
        />
        <Button
          label="Add an entry"
          icon="plus"
          variant="outline"
          size="sm"
          onPress={() => setEditing('new')}
        />
      </View>

      {/*
       * The other direction from the offer strip: pick a document and have it
       * read now, whatever was declined before. Web's `ReadDocumentMenu` says
       * why — the fit panel told people to "say yes when it offers" about a CV
       * the offer had already asked about once. Read ones are listed disabled
       * rather than hidden, so nobody reads a CV twice and files it all again.
       */}
      <MenuSheet
        open={choosing}
        onClose={() => setChoosing(false)}
        title="Read a document into your profile"
        actions={
          documents.length === 0
            ? [
                {
                  id: 'none',
                  label: 'Nothing in the Vault can be read yet',
                  hint: 'Add your CV or a statement and it appears here.',
                  disabled: true,
                  onPress: () => {},
                },
              ]
            : documents.map((d) => ({
                id: d.id,
                label: d.name,
                ...(d.read ? { hint: 'Already read', disabled: true } : {}),
                onPress: () => requestProfileRead({ fileId: d.id, name: d.name }),
              }))
        }
      />

      {all.length === 0 ? (
        <EmptyState
          icon="file-text"
          title="Nothing recorded yet"
          description={
            configured
              ? 'Put your CV, a research or teaching statement in the Vault and jojo will offer to read it — what it finds is shown to you before anything is saved. Or add an entry by hand.'
              : 'Reading a document needs a model. Connect one under More → Settings, then put your CV or a statement in the Vault. You can add entries by hand without one.'
          }
        />
      ) : (
        <View style={{ gap: space[5] }}>
          {groups.map(({ kind, rows }) => (
            <View key={kind}>
              <Txt size="xs" tone="muted" uppercase>
                {BACKGROUND_LABEL[kind]}
              </Txt>
              {rows.map((entry) => (
                <Entry
                  key={entry.id}
                  entry={entry}
                  onEdit={() => setEditing(entry)}
                  onDelete={() => setConfirming(entry)}
                />
              ))}
            </View>
          ))}
        </View>
      )}

      <ConfirmSheet
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title={confirming === null ? '' : `Remove ${confirming.title}?`}
        description="It goes from your background, so postings stop being weighed against it. The document it came from is untouched."
        confirmLabel="Remove"
        tone="danger"
        onConfirm={() => {
          if (confirming !== null) remove(confirming)
        }}
      />

      {editing !== null && (
        <EntrySheet
          key={editing === 'new' ? 'new' : editing.id}
          initial={editing === 'new' ? null : editing}
          open
          onClose={() => setEditing(null)}
        />
      )}
    </Panel>
  )
}
