import { useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { Feather } from '@react-native-vector-icons/feather/static'
import { useTranslation } from 'react-i18next'
import { Button, IconButton } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { MenuSheet } from '@/components/ui/Menu'
import type { MenuAction } from '@/components/ui/Menu'
import { Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import type { ChecklistItem } from '@jojo/service/core/model'
import { supersededToast } from '@jojo/service/react/undo'
import { useKg } from '@jojo/service/react/kg-context'
import { useChecklist } from '@/lib/checklist-agent'
import { useToast } from '@/lib/toast-context'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'

/**
 * What is still to be done before this application is sent.
 *
 * The state machine is `@jojo/service/react/use-checklist`, shared with the web;
 * what is here is the drawing and the phone's own affordances.
 *
 * Three things this card does differently from its neighbours, all because it
 * is the only panel on the record a person TOUCHES rather than reads:
 *
 *   - It is never blocked. A hand-typed list on an application with no posting
 *     and no model is still a checklist, so `blocked` withholds Draft alone.
 *   - Nothing is disabled while a draft runs. The list stays tappable.
 *   - A step is two lines, not one. A snippet TITLE is recognisable from half
 *     of it; an instruction is not, and "Request three reference letters
 *     through…" is the half that matters being cut off.
 *
 * The tick target is the whole row, not the 18pt box: a checkbox drawn at the
 * size it looks right is a quarter of the 44pt Apple and Android both ask for,
 * and this is the one control the card exists for.
 */
export function ChecklistPanel({ applicationId }: { applicationId: string }) {
  const { t } = useTranslation(['components', 'common'])
  const { text } = useKg()
  const c = useColors()
  const list = useChecklist(applicationId)
  const { toast } = useToast()
  const [draft, setDraft] = useState('')
  const [menuFor, setMenuFor] = useState<ChecklistItem | null>(null)
  const [editing, setEditing] = useState<ChecklistItem | null>(null)
  const [editText, setEditText] = useState('')

  const busy = list.running !== null
  const blocker = list.blockerFor(draft)

  const commit = () => {
    const text = draft.trim()
    if (text === '' || blocker !== null) return
    const result = list.add(text)
    if (result.ok) setDraft('')
    else {
      toast({
        title: t('checklist.notAdded'),
        description: result.errors[0]?.message ?? '',
        tone: 'danger',
      })
    }
  }

  const onDelete = (item: ChecklistItem) => {
    const done = list.remove(item.id)
    if (!done) return
    toast({
      title: t('checklist.deleted'),
      description: item.text,
      ...(done.restore
        ? {
            action: {
              label: t('common:actions.undo'),
              onPress: () => {
                const outcome = done.restore?.()
                if (outcome && outcome.superseded.length > 0) {
                  // `supersededToast` is written for the web's `onClick`; the
                  // phone's action takes `onPress`, so the fields are carried
                  // across by hand exactly as `TailoredPanel` does.
                  const said = supersededToast(outcome, text)
                  toast({
                    title: said.title,
                    ...(said.description === undefined ? {} : { description: said.description }),
                    ...(said.tone === undefined ? {} : { tone: said.tone }),
                  })
                }
              },
            },
          }
        : {}),
    })
  }

  const actionsFor = (item: ChecklistItem): MenuAction[] => [
    {
      id: 'edit',
      label: t('common:actions.edit'),
      icon: 'edit-2',
      onPress: () => {
        setEditText(item.text)
        setEditing(item)
      },
    },
    {
      id: 'delete',
      label: t('common:actions.delete'),
      icon: 'trash-2',
      tone: 'danger',
      onPress: () => {
        onDelete(item)
      },
    },
  ]

  return (
    <Panel>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
        <PanelTitle style={{ flex: 1 }}>
          {list.items.length > 0
            ? t('checklist.titleCount', { open: list.open, total: list.items.length })
            : t('checklist.title')}
        </PanelTitle>
        {list.blocked === null && !busy ? (
          <Button
            label={list.items.length === 0 ? t('checklist.draft') : t('checklist.draftMore')}
            variant="outline"
            icon="zap"
            onPress={list.draft}
          />
        ) : null}
      </View>

      {busy ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
          <Txt size="sm" tone="secondary" style={{ flex: 1 }}>
            {list.step}…
          </Txt>
          <Button label={t('common:actions.cancel')} variant="ghost" onPress={list.cancel} />
        </View>
      ) : null}

      {list.items.length > 0 ? (
        <View>
          {list.items.map((item) => {
            const done = item.doneOn !== undefined
            return (
              <View
                key={item.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space[2],
                  borderBottomWidth: 1,
                  borderBottomColor: c.hairline,
                }}
              >
                {/* The whole row is the target, so the tick is a 44pt strip
                    rather than an 18pt box. */}
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: done }}
                  accessibilityLabel={item.text}
                  onPress={() => {
                    list.tick(item.id, !done)
                  }}
                  style={{
                    flex: 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space[2],
                    minHeight: 44,
                    paddingVertical: space[1],
                  }}
                >
                  <View
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 4,
                      borderWidth: 1,
                      borderColor: done ? c.accent : c.hairlineStrong,
                      backgroundColor: done ? c.accent : 'transparent',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {done ? <Feather name="check" size={12} color={c.accentFg} /> : null}
                  </View>
                  <Txt
                    size="sm"
                    numberOfLines={2}
                    tone={done ? 'secondary' : undefined}
                    style={{
                      flex: 1,
                      ...(done ? { textDecorationLine: 'line-through' as const } : {}),
                    }}
                  >
                    {item.text}
                  </Txt>
                  {item.by ? (
                    <Txt size="xs" tone="secondary">
                      jojo
                    </Txt>
                  ) : null}
                </Pressable>
                <IconButton
                  icon="more-horizontal"
                  label={t('checklist.actionsFor', { step: item.text })}
                  onPress={() => {
                    setMenuFor(item)
                  }}
                />
              </View>
            )
          })}
        </View>
      ) : !busy ? (
        <EmptyState
          compact
          icon="check-square"
          title={t('checklist.empty.title')}
          description={
            list.blocked === 'no-posting'
              ? t('checklist.empty.noPosting')
              : list.blocked === 'no-model'
                ? t('checklist.empty.noModel')
                : t('checklist.empty.ready')
          }
        />
      ) : null}

      {/* ---------------------------- add your own --------------------------- */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space[2],
          borderTopWidth: 1,
          borderTopColor: c.hairline,
          paddingTop: space[2],
        }}
      >
        <Feather name="plus" size={14} color={c.text3} />
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={t('checklist.addStep')}
          placeholderTextColor={c.text3}
          accessibilityLabel={t('checklist.addStep')}
          returnKeyType="done"
          onSubmitEditing={commit}
          onBlur={commit}
          style={{ flex: 1, minHeight: 44, color: c.text1, fontSize: 15 }}
        />
      </View>
      {blocker !== null ? (
        <Txt size="xs" color={c.danger}>
          {blocker}
        </Txt>
      ) : null}

      {list.error !== null && !busy ? (
        <View style={{ gap: space[2] }}>
          <Txt size="sm" color={c.danger}>
            {list.error}
          </Txt>
          <Button label={t('common:actions.tryAgain')} variant="ghost" onPress={list.draft} />
        </View>
      ) : null}

      {/* Doubts, not failures: the list was drafted and saved. */}
      {list.notes.length > 0 && !busy
        ? list.notes.map((note) => (
            <Txt key={note} size="sm" tone="secondary">
              {note}
            </Txt>
          ))
        : null}

      <MenuSheet
        open={menuFor !== null}
        onClose={() => {
          setMenuFor(null)
        }}
        title={menuFor?.text ?? ''}
        actions={menuFor ? actionsFor(menuFor) : []}
      />

      {/* Inline rather than in a sheet, matching the Note field one panel
          down on this same screen. `Screen`'s ScrollView has no keyboard
          avoidance where `Sheet` does — so on the last row of a long record
          this can open under the keyboard, which is the cost the Note already
          pays and the consistency is worth more than the exception. */}
      {editing ? (
        <View style={{ gap: space[2] }}>
          <TextInput
            autoFocus
            value={editText}
            onChangeText={setEditText}
            accessibilityLabel={t('checklist.step')}
            style={{
              minHeight: 44,
              color: c.text1,
              fontSize: 15,
              borderBottomWidth: 1,
              borderBottomColor: c.accent,
            }}
            onBlur={() => {
              const next = editText.trim()
              if (next !== '' && editing && next !== editing.text) list.rename(editing.id, next)
              setEditing(null)
            }}
          />
        </View>
      ) : null}
    </Panel>
  )
}
