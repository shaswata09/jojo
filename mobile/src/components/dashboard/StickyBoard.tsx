import { useState } from 'react'
import { Pressable, StyleSheet, TextInput, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Button, IconButton } from '@/components/ui/Button'
import { toneSkin } from '@/components/ui/tone-skin'
import { Txt } from '@/components/ui/Text'
import type { LabelTone, StickyNote } from '@jojo/service/core/model'
import { DEFAULT_STICKY_TONE, LABEL_TONE_VALUES, MAX_STICKY_TEXT } from '@jojo/service/core/model'
import { dayOf } from '@jojo/service/core/project'
import { reminderFromNote } from '@jojo/service/core/sticky'
import { useStickyNotes } from '@jojo/service/react/use-sticky-notes'
import { useSheets } from '@/lib/sheets-context'
import { TODAY } from '@/lib/today'
import { useColors } from '@/theme/theme-context'
import { fonts, radius, space, type } from '@/theme/tokens'
import { useDomain } from '@/i18n/domain'

/**
 * Today's sticky notes: notes to self, quick to write and quick to throw away.
 *
 * The phone's half of the web's `dashboard/StickyBoard.tsx`, on the same
 * records (`useStickyNotes`, so a note stuck up on the laptop is here after a
 * Transfer) and the same paper-sticky rules: the box to write one is always
 * open, a note is edited where it sits, colour is the only organisation, and
 * a note that turns out to have a date becomes a reminder through the
 * reminder sheet rather than growing a date of its own.
 *
 * Two differences, both the keyboard's. Return adds a line here, because a
 * phone keyboard has no Shift to tell "new line" from "done" — so "Stick it"
 * is the way to stick one, and the placeholder does not promise Enter. And the
 * colours open as a row of swatches under the note rather than a popover,
 * because a popover anchored to a 32pt button is a target the thumb covers.
 */
export function StickyBoard() {
  const { t } = useTranslation('screens')
  const c = useColors()
  const { notes, create, update, remove } = useStickyNotes()
  const { open } = useSheets()
  const [draft, setDraft] = useState('')
  const [tone, setTone] = useState<LabelTone>(DEFAULT_STICKY_TONE)
  const [picking, setPicking] = useState(false)
  const skin = toneSkin(tone, c)

  const add = () => {
    const text = draft.trim()
    if (!text) return
    if (create(text, tone) !== null) setDraft('')
  }

  return (
    <View style={styles.board}>
      <View style={[styles.note, { backgroundColor: skin.bg, borderColor: skin.border }]}>
        <TextInput
          multiline
          value={draft}
          maxLength={MAX_STICKY_TEXT}
          onChangeText={setDraft}
          placeholder={t('today.sticky.placeholder')}
          placeholderTextColor={c.text3}
          accessibilityLabel={t('today.sticky.newNote')}
          style={[styles.input, { color: c.text1 }]}
        />
        <View style={styles.footer}>
          <IconButton
            icon="droplet"
            label={t('today.sticky.newColour')}
            active={picking}
            onPress={() => setPicking((was) => !was)}
          />
          <View style={styles.spacer} />
          <Button
            label={t('today.sticky.stick')}
            icon="plus"
            size="sm"
            disabled={!draft.trim()}
            onPress={add}
          />
        </View>
        {picking ? (
          <Swatches
            tone={tone}
            onPick={(next) => {
              setTone(next)
              setPicking(false)
            }}
          />
        ) : null}
      </View>

      {notes.length === 0 ? (
        <Txt size="sm" tone="muted">
          {t('today.sticky.empty')}
        </Txt>
      ) : (
        <View accessibilityLabel={t('today.sticky.listLabel')} style={styles.list}>
          {notes.map((note) => (
            <StickyCard
              key={note.id}
              note={note}
              onSave={(text) => update(note.id, { text })}
              onTone={(next) => update(note.id, { tone: next })}
              onRemove={() => remove(note.id)}
              onReminder={() =>
                open('timelineItem', {
                  mode: 'reminder',
                  initial: reminderFromNote(note.text, TODAY),
                })
              }
            />
          ))}
        </View>
      )}
    </View>
  )
}

function StickyCard({
  note,
  onSave,
  onTone,
  onRemove,
  onReminder,
}: {
  note: StickyNote
  onSave: (text: string) => void
  onTone: (tone: LabelTone) => void
  onRemove: () => void
  onReminder: () => void
}) {
  const { t } = useTranslation('screens')
  const domain = useDomain()
  const c = useColors()
  const [editing, setEditing] = useState(false)
  const [picking, setPicking] = useState(false)
  const [text, setText] = useState(note.text)
  const skin = toneSkin(note.tone, c)
  const first = note.text.trim().split('\n')[0] ?? ''

  /*
   * Saved when the field loses focus, because a paper sticky has no Save
   * button and tapping away is how people finish. Emptying a note does not
   * delete it — that is what ✕ is for, with an Undo — so an emptied note just
   * goes back to what it said.
   */
  const finish = () => {
    setEditing(false)
    const clean = text.trim()
    if (clean && clean !== note.text) onSave(clean)
  }

  return (
    <View style={[styles.note, { backgroundColor: skin.bg, borderColor: skin.border }]}>
      {editing ? (
        <TextInput
          multiline
          autoFocus
          value={text}
          maxLength={MAX_STICKY_TEXT}
          onChangeText={setText}
          onBlur={finish}
          accessibilityLabel={t('today.sticky.editNote')}
          style={[styles.input, { color: c.text1 }]}
        />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('today.sticky.editAria', { text: first })}
          onPress={() => {
            setText(note.text)
            setEditing(true)
          }}
          style={styles.read}
        >
          <Txt size="sm" numberOfLines={6}>
            {note.text}
          </Txt>
        </Pressable>
      )}

      <View style={styles.footer}>
        <Txt size="xs" tone="muted" style={styles.spacer}>
          {domain.ago(dayOf(note.createdAt), TODAY)}
        </Txt>
        <IconButton
          icon="droplet"
          label={t('today.sticky.colourOf', { text: first })}
          active={picking}
          onPress={() => setPicking((was) => !was)}
        />
        <IconButton
          icon="bell"
          label={t('today.sticky.toReminderAria', { text: first })}
          onPress={onReminder}
        />
        <IconButton
          icon="x"
          label={t('today.sticky.removeAria', { text: first })}
          onPress={onRemove}
        />
      </View>

      {picking ? (
        <Swatches
          tone={note.tone}
          onPick={(next) => {
            setPicking(false)
            if (next !== note.tone) onTone(next)
          }}
        />
      ) : null}
    </View>
  )
}

/**
 * The eight keyword colours, in the palette's own order — the list `s.enum`
 * validates against, so this offers exactly what will save. Picking one closes
 * the row.
 */
function Swatches({ tone, onPick }: { tone: LabelTone; onPick: (tone: LabelTone) => void }) {
  const { t } = useTranslation('screens')
  const domain = useDomain()
  const c = useColors()
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={t('today.sticky.colour')} style={styles.swatches}>
      {LABEL_TONE_VALUES.map((swatch) => {
        const on = swatch === tone
        return (
          <Pressable
            key={swatch}
            accessibilityRole="radio"
            accessibilityLabel={domain.tone(swatch)}
            accessibilityState={{ checked: on }}
            hitSlop={6}
            onPress={() => onPick(swatch)}
            style={[
              styles.swatch,
              { backgroundColor: toneSkin(swatch, c).fg, borderColor: on ? c.text1 : 'transparent' },
            ]}
          />
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  board: { gap: space[3] },
  list: { gap: space[2.5] },
  note: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space[3],
  },
  input: {
    minHeight: 56,
    padding: 0,
    fontFamily: fonts.regular,
    fontSize: type.sm,
    lineHeight: 20,
    textAlignVertical: 'top',
  },
  read: { minHeight: 44 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space[1], marginTop: space[2] },
  spacer: { flex: 1 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3], marginTop: space[2.5] },
  swatch: { width: 26, height: 26, borderRadius: 13, borderWidth: 2 },
})
