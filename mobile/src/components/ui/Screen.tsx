import { Children, useState } from 'react'
import type { ReactNode } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import type { ScrollViewProps } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { IconButton } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { Txt } from '@/components/ui/Text'
import { useLayout } from '@/lib/use-layout'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'

/**
 * The page frame: a title block, then whatever the screen renders.
 *
 * `options` is the equivalent of the web `PageHeader`'s settings popover — the
 * per-page switches (show notes, dots instead of titles, compare with a typical
 * search). They live behind the ⋯ rather than in the toolbar because they are
 * read once and then never again, and a phone has no width to spend on them.
 */
export function Screen({
  title,
  subtitle,
  actions,
  options,
  children,
  scroll = true,
  contentContainerStyle,
  ...rest
}: ScrollViewProps & {
  title: string
  subtitle?: string
  /** Buttons in the title row — the page's primary create action. */
  actions?: ReactNode
  /** Switches behind the ⋯ button. */
  options?: ReactNode
  children: ReactNode
  scroll?: boolean
}) {
  const c = useColors()
  const insets = useSafeAreaInsets()
  const { gutter } = useLayout()
  const [optionsOpen, setOptionsOpen] = useState(false)

  // Recomputed every render rather than baked into the stylesheet, because both
  // halves of it move: the gutter widens when the phone turns, and `insets`
  // changes with it as the notch swings to the side.
  const pad = { paddingLeft: gutter, paddingRight: gutter }

  const header = (
    <View style={styles.header}>
      <View style={s.fill}>
        <Txt size="xl" weight="semibold">
          {title}
        </Txt>
        {subtitle ? (
          <Txt size="sm" tone="muted" style={{ marginTop: space[1] }}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
      <View style={styles.headerActions}>
        {actions}
        {options ? (
          <IconButton
            icon="sliders"
            label="Page options"
            active={optionsOpen}
            onPress={() => setOptionsOpen(true)}
          />
        ) : null}
      </View>
    </View>
  )

  const body = (
    <>
      {header}
      {children}
    </>
  )

  return (
    <View style={[styles.root, { backgroundColor: c.page }]}>
      {scroll ? (
        <ScrollView
          {...rest}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.content,
            pad,
            { paddingBottom: insets.bottom + space[10] },
            contentContainerStyle,
          ]}
        >
          {body}
        </ScrollView>
      ) : (
        <View style={[styles.content, pad, styles.fill]}>{body}</View>
      )}

      {options ? (
        <Sheet
          open={optionsOpen}
          onClose={() => setOptionsOpen(false)}
          title="Page options"
          description="These apply to this screen only, for this visit."
        >
          <View style={{ paddingBottom: space[2] }}>{options}</View>
        </Sheet>
      ) : null}
    </View>
  )
}

/**
 * Panels side by side once there is room, stacked when there is not.
 *
 * Opt-in rather than automatic, because "the children of this screen" and "the
 * panels of this screen" are not the same set. Applications leads with a
 * toolbar, a search field and a row of filters before its list; splitting that
 * lot in two would put the search box beside the results. Only a screen that is
 * genuinely a stack of independent panels — Today, More, Settings — can be cut
 * down the middle, and only that screen knows it.
 *
 * The split alternates rather than measuring: index 0, 2, 4 go left and 1, 3, 5
 * right. Real balancing needs heights, heights need a layout pass, and a layout
 * pass means the columns visibly reshuffle after first paint. Alternating is
 * stable, runs before paint, and on a stack of panels of roughly similar size
 * lands close enough that the difference is not worth the flash.
 */
export function Columns({ children }: { children: ReactNode }) {
  const { columns } = useLayout()
  const items = Children.toArray(children).filter(Boolean)

  if (columns === 1) return <View style={styles.stack}>{children}</View>

  return (
    <View style={styles.columns}>
      <View style={styles.column}>{items.filter((_, i) => i % 2 === 0)}</View>
      <View style={styles.column}>{items.filter((_, i) => i % 2 === 1)}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  stack: { gap: space[4] },
  // `flex-start`, so a short column ends where its content ends rather than
  // stretching a panel's background down to match the taller one beside it.
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: space[4] },
  column: { flex: 1, minWidth: 0, gap: space[4] },
  // Horizontal padding is supplied by `useLayout`, not here — it has to track
  // rotation. Only the vertical half is static.
  content: { paddingVertical: space[3], gap: space[4] },
  fill: { flex: 1, minHeight: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space[3],
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexShrink: 0 },
})
