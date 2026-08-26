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
import { BACKGROUND_LABEL, BACKGROUND_ORDER } from '@jojo/service/core/model'
import type { Background, BackgroundKind } from '@jojo/service/core/model'
import { useGraph, useKg } from '@jojo/service/react/kg-context'
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

function Entry({ entry, onDelete }: { entry: Background; onDelete: () => void }) {
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
   * Adding a fact by hand — the phone had no route either.
   *
   * See web's `BackgroundPanel` for the argument: the CV reader was the only
   * writer, so a fact no document of yours mentions (most volunteering, most
   * outreach, an award announced in an email) could not be recorded at all, and
   * a panel with a delete and no add reads as a view of a document rather than
   * as your profile.
   *
   * A sheet rather than an inline form, because that is what this app does with
   * every other multi-field edit on a phone, and because the keyboard covers
   * half the screen the moment the first field is focused.
   */
  const [adding, setAdding] = useState(false)
  const [kindOpen, setKindOpen] = useState(false)
  const empty = { kind: 'employment' as BackgroundKind, title: '', where: '', period: '', detail: '' }
  const [draft, setDraft] = useState(empty)

  const add = () => {
    const title = draft.title.trim()
    if (title === '') return
    const result = run('profile.background.add', {
      background: [
        {
          kind: draft.kind,
          title,
          // An empty box is an ABSENT field, not an empty string — the same
          // `exactOptionalPropertyTypes` care web's copy takes. Sending '' puts
          // a blank "Where" on the row.
          ...(draft.where.trim() === '' ? {} : { where: draft.where.trim() }),
          ...(draft.period.trim() === '' ? {} : { period: draft.period.trim() }),
          ...(draft.detail.trim() === '' ? {} : { detail: draft.detail.trim() }),
        },
      ],
    })
    toast({
      title: result.ok ? `${title} added` : 'That did not save',
      ...(result.ok
        ? result.undo
          ? { action: { label: 'Undo', onPress: result.undo } }
          : {}
        : { description: result.errors[0]?.message, tone: 'danger' as const }),
    })
    if (result.ok) {
      setDraft(empty)
      setAdding(false)
    }
  }

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

      <View style={{ alignItems: 'flex-end', marginBottom: space[2] }}>
        <Button
          label="Add an entry"
          icon="plus"
          variant="outline"
          size="sm"
          onPress={() => setAdding(true)}
        />
      </View>

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
                <Entry key={entry.id} entry={entry} onDelete={() => setConfirming(entry)} />
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

      <Sheet
        open={adding}
        onClose={() => setAdding(false)}
        title="Add to your background"
        description="Anything a posting should be weighed against. Nothing here is sent anywhere."
        footer={
          <>
            <Button label="Cancel" variant="ghost" size="md" onPress={() => setAdding(false)} />
            <Button label="Add" size="md" disabled={draft.title.trim() === ''} onPress={add} />
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
            value={draft.title}
            placeholder="What it was"
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
            label="Detail"
            value={draft.detail}
            multiline
            placeholder="Optional"
            onChangeText={(detail) => setDraft({ ...draft, detail })}
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
    </Panel>
  )
}
