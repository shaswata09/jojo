import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { Feather } from '@react-native-vector-icons/feather/static'
import { Button, IconButton } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Sheet } from '@/components/ui/Sheet'
import { Txt } from '@/components/ui/Text'
import { useLabels } from '@/lib/labels-context'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { fonts, radius, space, type } from '@/theme/tokens'

/**
 * The keywords on one record, as capsules.
 *
 * Returns nothing when the record has none, so an untagged row costs no extra
 * height — which is what lets this sit on every row in every list.
 */
export function LabelChips({ recordId }: { recordId: string }) {
  const { labelsOf } = useLabels()
  const labels = labelsOf(recordId)
  if (labels.length === 0) return null

  return (
    <View style={styles.chips}>
      {labels.map((l) => (
        <Chip key={l.id} tone={l.tone} shape="capsule" size="sm">
          {l.name}
        </Chip>
      ))}
    </View>
  )
}

/**
 * Add or remove keywords on a saved record, writing straight through.
 *
 * Right beside a row that already exists — wrong inside a form, where Cancel
 * has to be able to discard them. `StagedKeywordPicker` below is the version
 * the sheets use.
 */
export function LabelPicker({ recordId, name }: { recordId: string; name: string }) {
  const { labels, labelIdsOf, toggleOn, addLabel } = useLabels()
  const [open, setOpen] = useState(false)
  const picked = new Set(labelIdsOf(recordId))

  return (
    <>
      <IconButton icon="tag" label={`Keywords on ${name}`} onPress={() => setOpen(true)} />
      <KeywordSheet
        open={open}
        onClose={() => setOpen(false)}
        title={`Keywords on ${name}`}
        picked={picked}
        labels={labels}
        onToggle={(id) => toggleOn(recordId, id)}
        onCreate={(text) => {
          const id = addLabel(text)
          if (id && !picked.has(id)) toggleOn(recordId, id)
        }}
      />
    </>
  )
}

/**
 * The same picker, staged.
 *
 * A form's keyword field must not write on tap: in create mode there is no
 * record id to write to, and in edit mode it would commit keywords that Cancel
 * is supposed to discard. This holds the selection and hands it back for the
 * caller to commit on save.
 */
export function StagedKeywordPicker({
  value,
  onChange,
}: {
  value: string[]
  onChange: (next: string[]) => void
}) {
  const { labels, addLabel } = useLabels()
  const [open, setOpen] = useState(false)
  const picked = useMemo(() => new Set(value), [value])
  const chosen = labels.filter((l) => picked.has(l.id))

  return (
    <View style={styles.stagedRow}>
      {chosen.length === 0 ? (
        <Txt size="sm" tone="muted">
          None yet
        </Txt>
      ) : (
        chosen.map((l) => (
          <Chip key={l.id} tone={l.tone} shape="capsule" size="sm">
            {l.name}
          </Chip>
        ))
      )}

      <Button label="Choose" icon="tag" variant="outline" size="sm" onPress={() => setOpen(true)} />

      <KeywordSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Keywords"
        picked={picked}
        labels={labels}
        onToggle={(id) => onChange(picked.has(id) ? value.filter((v) => v !== id) : [...value, id])}
        onCreate={(text) => {
          // Returns the existing id when the name is already taken, so typing a
          // keyword that exists selects it rather than minting a duplicate.
          const id = addLabel(text)
          if (id && !picked.has(id)) onChange([...value, id])
        }}
      />
    </View>
  )
}

function KeywordSheet({
  open,
  onClose,
  title,
  labels,
  picked,
  onToggle,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  title: string
  labels: ReturnType<typeof useLabels>['labels']
  picked: ReadonlySet<string>
  onToggle: (id: string) => void
  onCreate: (name: string) => void
}) {
  const c = useColors()
  const [draft, setDraft] = useState('')

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      description="Keywords are yours, and shared by applications, reminders, files and links — filtering by one finds all of them."
    >
      <ScrollView style={styles.keywordList} bounces={false}>
        {labels.map((l) => {
          const on = picked.has(l.id)
          return (
            <Pressable
              key={l.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              onPress={() => onToggle(l.id)}
              style={({ pressed }) => [
                styles.keywordRow,
                { backgroundColor: pressed ? c.rowHover : 'transparent' },
              ]}
            >
              <View
                style={[
                  styles.box,
                  {
                    backgroundColor: on ? c.accent : 'transparent',
                    borderColor: on ? c.accent : c.hairlineStrong,
                  },
                ]}
              >
                {on ? <Feather name="check" size={13} color={c.accentFg} /> : null}
              </View>
              <Chip tone={l.tone} shape="capsule" size="sm">
                {l.name}
              </Chip>
            </Pressable>
          )
        })}
      </ScrollView>

      <View style={[styles.newRow, { borderTopColor: c.hairline }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="New keyword…"
          placeholderTextColor={c.text3}
          accessibilityLabel="New keyword"
          returnKeyType="done"
          onSubmitEditing={() => {
            const name = draft.trim()
            if (!name) return
            onCreate(name)
            setDraft('')
          }}
          style={[
            styles.newInput,
            { color: c.text1, backgroundColor: c.well, borderColor: c.hairlineStrong },
          ]}
        />
        <Button
          label="Add"
          size="md"
          disabled={!draft.trim()}
          onPress={() => {
            const name = draft.trim()
            if (!name) return
            onCreate(name)
            setDraft('')
          }}
        />
      </View>
    </Sheet>
  )
}

/**
 * The keyword filter above a list.
 *
 * `scopeIds` is what stops a chip counting the whole store: on the applications
 * list a keyword has to report how many *applications* carry it, not how many
 * reminders and vault files do as well.
 */
export function LabelFilter({ scopeIds }: { scopeIds: string[] }) {
  const { labels, selected, toggleSelected, clearSelected, countsWithin } = useLabels()
  const c = useColors()

  /*
   * One pass for every chip, and it was worse here than on web: `countWithin`
   * ran once in the `filter` and AGAIN inside the map for each surviving chip,
   * so the pool was walked twice per keyword. Phones have no JIT.
   */
  const counts = useMemo(() => countsWithin(scopeIds), [countsWithin, scopeIds])

  const shown = labels.filter((l) => (counts.get(l.id) ?? 0) > 0 || selected.has(l.id))
  if (shown.length === 0) return null

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={styles.filterRow}>
        {shown.map((l) => {
          const on = selected.has(l.id)
          const count = counts.get(l.id) ?? 0
          return (
            <Pressable
              key={l.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${l.name}, ${count} here`}
              onPress={() => toggleSelected(l.id)}
              style={[
                styles.filterChip,
                {
                  backgroundColor: on ? c.accentSoft : c.well,
                  borderColor: on ? c.accentBorder : c.hairline,
                },
              ]}
            >
              <View style={[styles.toneDot, { backgroundColor: toneColor(l.tone, c) }]} />
              {/* Keyword names are typed by the user, so their length is not
                  something this layout gets to assume. */}
              <Txt
                size="sm"
                tone={on ? 'accent' : 'secondary'}
                weight={on ? 'medium' : 'regular'}
                numberOfLines={1}
                style={s.shrink}
              >
                {l.name}
              </Txt>
              <Txt size="xs" mono tone="muted">
                {count}
              </Txt>
            </Pressable>
          )
        })}

        {selected.size > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={clearSelected}
            style={[styles.filterChip, { backgroundColor: 'transparent', borderColor: c.hairline }]}
          >
            <Feather name="x" size={13} color={c.text3} />
            <Txt size="sm" tone="muted">
              Clear
            </Txt>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
  )
}

function toneColor(tone: string, c: ReturnType<typeof useColors>) {
  if (tone === 'teal') return c.info
  if (tone === 'amber') return c.warning
  if (tone === 'red') return c.danger
  if (tone === 'green') return c.success
  return c.text3
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1.5] },
  stagedRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2] },
  keywordList: { flexGrow: 0, maxHeight: 320 },
  keywordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: 48,
    paddingHorizontal: space[2],
    borderRadius: radius.md,
  },
  box: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingTop: space[3],
    marginTop: space[2],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  newInput: {
    flex: 1,
    height: 44,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space[3],
    fontFamily: fonts.regular,
    fontSize: type.base,
  },
  filterRow: { flexDirection: 'row', gap: space[2], paddingRight: space[3] },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1.5],
    minHeight: 36,
    paddingHorizontal: space[3],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
    maxWidth: '100%',
  },
  toneDot: { width: 7, height: 7, borderRadius: 3.5 },
})
