import type { ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Feather } from '@react-native-vector-icons/feather/static'
import { Sheet } from '@/components/ui/Sheet'
import { Txt } from '@/components/ui/Text'
import type { FeatherName } from '@/lib/timeline-visuals'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { radius, space } from '@/theme/tokens'

export type MenuAction = {
  id: string
  label: string
  hint?: string
  icon?: FeatherName
  tone?: 'default' | 'danger'
  /** Ticked, for a menu that is really a single choice — the stage picker. */
  checked?: boolean
  /** A dot in the row's own colour, for the stage picker. */
  dotColor?: string
  disabled?: boolean
  blocker?: string
  onPress: () => void
}

/**
 * An overflow menu, as a sheet.
 *
 * The web app hangs these off a popover anchored to the ⋯ button. A popover
 * anchored to a 28px target is a pointer idiom — on a phone the same list is a
 * sheet from the bottom, where every row is a full-width 52pt target and none
 * of them is under the finger that opened it.
 */
export function MenuSheet({
  open,
  onClose,
  title,
  description,
  actions,
  children,
}: {
  open: boolean
  onClose: () => void
  title?: string
  description?: string
  actions: MenuAction[]
  children?: ReactNode
}) {
  const c = useColors()

  return (
    <Sheet open={open} onClose={onClose} title={title} description={description}>
      {children}
      <ScrollView style={styles.list} bounces={false}>
        {actions.map((a) => (
          <Pressable
            key={a.id}
            accessibilityRole="button"
            accessibilityState={{ disabled: Boolean(a.disabled), checked: a.checked }}
            disabled={a.disabled}
            onPress={() => {
              onClose()
              a.onPress()
            }}
            style={({ pressed }) => [
              styles.row,
              {
                backgroundColor: pressed ? c.rowHover : 'transparent',
                opacity: a.disabled ? 0.45 : 1,
              },
            ]}
          >
            {a.dotColor ? (
              <View style={[styles.dot, { backgroundColor: a.dotColor }]} />
            ) : a.icon ? (
              <Feather name={a.icon} size={17} color={a.tone === 'danger' ? c.danger : c.text2} />
            ) : null}

            <View style={s.fill}>
              <Txt size="base" tone={a.tone === 'danger' ? 'danger' : 'primary'}>
                {a.label}
              </Txt>
              {a.hint || a.blocker ? (
                <Txt size="xs" tone="muted" style={{ marginTop: 1 }}>
                  {a.blocker ?? a.hint}
                </Txt>
              ) : null}
            </View>

            {a.checked ? <Feather name="check" size={17} color={c.accent} /> : null}
          </Pressable>
        ))}
      </ScrollView>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  // `flexGrow: 0` keeps a three-item menu from stretching to fill the sheet.
  // `flexShrink: 1` is the other half: a fourteen-item one has to be squeezed
  // by the sheet's height cap rather than overflow it, or it never scrolls.
  list: { flexGrow: 0, flexShrink: 1, minHeight: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: 52,
    paddingHorizontal: space[2],
    borderRadius: radius.md,
  },
  dot: { width: 10, height: 10, borderRadius: 5, marginHorizontal: 3.5 },
})
