import { Text } from 'react-native'
import type { StyleProp, TextStyle } from 'react-native'
import { runsOf } from '@jojo/service/core/note-format'
import type { LabelTone, NoteSize, NoteSpan } from '@jojo/service/core/model'
import { useColors } from '@/theme/theme-context'
import { fonts, type as typeScale } from '@/theme/tokens'

/**
 * An application's note, with the formatting the person gave it.
 *
 * Driven by `runsOf`, the same partitioner the web uses, so the phone and the
 * browser cannot disagree about which characters are bold — and so this does no
 * offset arithmetic of its own and cannot drop a character.
 *
 * ## Why this is not `Marked`
 *
 * `Marked.tsx` paints bold with `backgroundColor: c.accentSoft`, and
 * `MARK_LEGEND.bold` defines that fill as "new or rewritten for this posting".
 * Drawing a person's own bold with it would tell them a model wrote their note.
 * This uses weight alone, with no fill.
 *
 * ## Why colour comes from the chip map
 *
 * A note's colour is a `LabelTone` name — never a hex — so it resolves through
 * the same eight the keyword chips use, which are already correct in both
 * themes. Nothing here interprets a string from the store as a colour value.
 */
export function NoteText({
  note,
  format,
  style,
}: {
  note: string
  format: readonly NoteSpan[] | undefined
  style?: StyleProp<TextStyle>
}) {
  const c = useColors()

  const ink: Record<LabelTone, string> = {
    gray: c.text2,
    teal: c.info,
    cyan: c.kwCyan,
    green: c.success,
    amber: c.warning,
    red: c.danger,
    pink: c.kwPink,
    violet: c.kwViolet,
  }

  /** The same three steps the web offers, against the field's own base size. */
  const scale: Record<NoteSize, number> = {
    small: typeScale.sm,
    large: typeScale.lg,
    huge: typeScale.xl,
  }

  const runs = runsOf(note, format)

  return (
    <Text selectable style={[{ color: c.text1, fontSize: typeScale.base, lineHeight: 22 }, style]}>
      {runs.map((run, index) => (
        <Text
          // Position is the identity: runs have no ids and the list is rebuilt
          // whole on every change, so nothing is preserved across a re-render.
          key={index}
          style={{
            ...(run.bold === true ? { fontFamily: fonts.semibold } : {}),
            ...(run.italic === true ? { fontStyle: 'italic' as const } : {}),
            ...(run.underline === true || run.strike === true
              ? {
                  textDecorationLine:
                    run.underline === true && run.strike === true
                      ? ('underline line-through' as const)
                      : run.underline === true
                        ? ('underline' as const)
                        : ('line-through' as const),
                }
              : {}),
            ...(run.colour === undefined ? {} : { color: ink[run.colour] }),
            ...(run.size === undefined ? {} : { fontSize: scale[run.size] }),
          }}
        >
          {run.text}
        </Text>
      ))}
    </Text>
  )
}
