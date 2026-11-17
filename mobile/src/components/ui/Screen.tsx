import { Children, createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import type { ScrollViewProps } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { TourScrollContext, type Scroller } from '@/components/tour/registry'
import { IconButton } from '@/components/ui/Button'
import { FocusArrivalContext, FocusScopeContext, useFocusScope } from '@/components/ui/focus-scope'
import { Sheet } from '@/components/ui/Sheet'
import { Txt } from '@/components/ui/Text'
import { useLayout } from '@/lib/use-layout'
import { useLatchedFocus } from '@/lib/use-row-cap'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'

/**
 * How many columns the surrounding `Screen` settled on.
 *
 * `Columns` cannot work this out for itself: it would have to re-read the device
 * width and re-apply the rule, and the two copies could disagree with the
 * padding `Screen` already committed to — which is how content ends up split
 * into two columns inside a frame sized for one. So `Screen` decides once and
 * says so here.
 *
 * The default is 1 rather than "ask the device", so a `Columns` rendered outside
 * a `Screen` stacks instead of silently splitting into a width nobody reserved.
 */
const ColumnsContext = createContext<1 | 2>(1)

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
  wide = false,
  scroll = true,
  focus,
  openOptions = false,
  onArrived,
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
  /**
   * This screen lays its panels out in two columns when there is room.
   *
   * Set it on a screen that renders `<Columns>`, and leave it off everywhere
   * else. It decides BOTH how wide the content may get and whether `Columns`
   * actually splits — one answer, computed here, shared through the context
   * below, so the padding and the split can never disagree.
   *
   * Off by default because most screens are a single column, and the old
   * behaviour — deciding from the device width alone — gave those screens the
   * two-column width cap and drew them 1042dp wide on a tablet.
   */
  wide?: boolean
  scroll?: boolean
  /**
   * A `FocusTarget` id to scroll into view and light — a search result
   * arriving. One-shot: `onArrived` runs once it is taken, so the screen can
   * clear the route param it came in.
   */
  focus?: string
  /** Opens the ⋯ options sheet — a search result for one of its switches. */
  openOptions?: boolean
  /** Called once `focus` or `openOptions` has been acted on. */
  onArrived?: () => void
}) {
  const { t } = useTranslation()
  const c = useColors()
  const insets = useSafeAreaInsets()
  const layout = useLayout(wide ? 2 : 1)
  const { gutter, short } = layout
  const [optionsOpen, setOptionsOpen] = useState(false)

  // How the guided tour brings a control it points at into view: a control
  // marked with `TourTarget` inside this screen scrolls it by the distance the
  // tour asks for. The offset is tracked here because a ScrollView will not
  // say where it is.
  const scrollRef = useRef<ScrollView>(null)
  const innerRef = useRef<View>(null)
  const offset = useRef(0)
  const scroller = useMemo<Scroller>(
    () => ({
      scrollBy: (dy) =>
        scrollRef.current?.scrollTo({ y: Math.max(0, offset.current + dy), animated: true }),
    }),
    [],
  )

  // Where a search result lands: see `FocusTarget`.
  const focusScope = useFocusScope(focus, onArrived, scrollRef, innerRef)
  // The arrival, latched for the capped lists below (`FocusArrivalContext`), so
  // a list's first render already includes the row the scope looks for 120ms on.
  const arriving = useLatchedFocus(focus)
  const arrived = useRef(onArrived)
  arrived.current = onArrived
  useEffect(() => {
    if (!openOptions) return
    // Acknowledged even when this render has no options to show (Statistics
    // offers none on an empty store), so the request stays one-shot.
    if (options) setOptionsOpen(true)
    arrived.current?.()
    // `options` is a fresh element every render; only the request is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openOptions])

  // Recomputed every render rather than baked into the stylesheet, because both
  // halves of it move: the gutter widens when the phone turns, and `insets`
  // changes with it as the notch swings to the side.
  const pad = { paddingLeft: gutter, paddingRight: gutter }

  const header = (
    <View style={styles.header}>
      <View style={s.fill}>
        {/* The screen's heading, and the phone's equivalent of an <h1>. Every
            screen goes through this frame, so one prop here gives TalkBack and
            VoiceOver a heading to land on everywhere. */}
        {/* Smaller on a phone held sideways, and the subtitle goes entirely.
            Together they give back ~35dp of a 411dp-tall screen — see `short`
            in `layout-math.ts` for where that number comes from. The subtitle
            is the right thing to drop because it is context rather than
            navigation: it says what the page is FOR, which is worth reading
            once and never again, while the title says where you are. */}
        <Txt size={short ? 'lg' : 'xl'} weight="semibold" heading>
          {title}
        </Txt>
        {subtitle && !short ? (
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
            label={t('pageOptions.title')}
            active={optionsOpen}
            onPress={() => setOptionsOpen(true)}
          />
        ) : null}
      </View>
    </View>
  )

  const body = (
    <FocusScopeContext.Provider value={focusScope}>
      <FocusArrivalContext.Provider value={arriving}>
        <ColumnsContext.Provider value={layout.columns}>
          {header}
          {children}
        </ColumnsContext.Provider>
      </FocusArrivalContext.Provider>
    </FocusScopeContext.Provider>
  )

  return (
    <View style={[styles.root, { backgroundColor: c.page }]}>
      {scroll ? (
        <ScrollView
          {...rest}
          ref={scrollRef}
          // The prop is typed for a ref that is never empty, which React 19's
          // `useRef(null)` is not; the ScrollView fills it before any layout.
          innerViewRef={innerRef as RefObject<View>}
          onScroll={(event) => {
            offset.current = event.nativeEvent.contentOffset.y
            rest.onScroll?.(event)
          }}
          scrollEventThrottle={rest.scrollEventThrottle ?? 32}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.content,
            pad,
            // Tighter top-and-gap in a short viewport, for the same reason the
            // type shrinks. The bottom keeps its full run-out so the last panel
            // can still be scrolled clear of the tab bar.
            short ? styles.contentShort : null,
            { paddingBottom: insets.bottom + space[10] },
            contentContainerStyle,
          ]}
        >
          <TourScrollContext.Provider value={scroller}>{body}</TourScrollContext.Provider>
        </ScrollView>
      ) : (
        <View style={[styles.content, pad, short ? styles.contentShort : null, styles.fill]}>
          {body}
        </View>
      )}

      {options ? (
        <Sheet
          open={optionsOpen}
          onClose={() => setOptionsOpen(false)}
          title={t('pageOptions.title')}
          description={t('pageOptions.description')}
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
  const columns = useContext(ColumnsContext)
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
  contentShort: { paddingTop: space[2], gap: space[3] },
  fill: { flex: 1, minHeight: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space[3],
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexShrink: 0 },
})
