import { useCallback, useMemo, useRef, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  runOnJS,
  scrollTo,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import type { SharedValue } from 'react-native-reanimated'
import { Feather } from '@expo/vector-icons'
import { LabelChips } from '@/components/common/Labels'
import { StagePicker } from '@/components/common/StagePicker'
import { Chip } from '@/components/ui/Chip'
import { Txt } from '@/components/ui/Text'
import { STAGES, displayName } from '@/data/seed'
import type { Application } from '@/data/seed'
import { refKey } from '@/lib/ids'
import { useSheets } from '@/lib/sheets-context'
import type { RowActions } from '@/screens/applications/use-row-actions'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { radius, space } from '@/theme/tokens'

const COLUMN_W = 250
const COLUMN_GAP = space[2.5]
const COLUMN_STRIDE = COLUMN_W + COLUMN_GAP
/** How near an edge the finger has to get before the board scrolls itself. */
const EDGE = 72
/** Points per frame inside that zone — roughly 480pt/second at 60fps. */
const EDGE_SPEED = 8
/** Hold this long and the card lifts. Below ~200ms taps start arming a drag. */
const LIFT_DELAY = 220

/**
 * One card, drawn identically in its column and under the finger.
 *
 * Shared rather than duplicated so the thing you are dragging is provably the
 * thing you picked up — when the floating copy had its own JSX the two drifted
 * apart the first time a chip was added to one of them.
 */
function BoardCard({
  application: a,
  actions,
  state = 'idle',
  onOpen,
}: {
  application: Application
  actions: RowActions
  /** `source` is the gap left behind mid-drag; `floating` follows the finger. */
  state?: 'idle' | 'source' | 'floating'
  onOpen?: (id: string) => void
}) {
  const c = useColors()

  return (
    <Pressable
      accessibilityRole="button"
      // Announced on the card itself, because a drag is invisible to anyone who
      // cannot see the board — and the stage menu below stays the route that
      // does not require one.
      accessibilityHint="Press and hold to move this to another stage"
      onPress={onOpen ? () => onOpen(a.id) : undefined}
      style={[
        styles.card,
        { backgroundColor: c.panel, borderColor: c.hairline },
        state === 'source' && styles.cardSource,
        state === 'floating' && [styles.cardFloating, { borderColor: c.accent }],
      ]}
    >
      <View style={s.row}>
        <Txt size="sm" weight="semibold" style={s.fill} numberOfLines={2}>
          {displayName(a)}
        </Txt>
        {a.flagged ? <Feather name="flag" size={13} color={c.danger} /> : null}
      </View>
      {a.note ? (
        <Txt size="xs" tone="muted" numberOfLines={2} style={{ marginTop: 2 }}>
          {a.note}
        </Txt>
      ) : null}
      <View style={s.chipRow}>
        <StagePicker
          value={a.stage}
          name={displayName(a)}
          onSelect={(next) => actions.onMoveStage(a, next)}
        />
        <Chip size="sm" tone="gray">
          {a.roleTag}
        </Chip>
      </View>
      <LabelChips recordId={refKey('app', a.id)} />
    </Pressable>
  )
}

/** The shared state a card's drag gesture reads and writes. */
type DragControl = {
  wrapX: SharedValue<number>
  wrapY: SharedValue<number>
  viewportW: SharedValue<number>
  scrollX: SharedValue<number>
  pointerX: SharedValue<number>
  pointerY: SharedValue<number>
  grabX: SharedValue<number>
  grabY: SharedValue<number>
  lift: SharedValue<number>
  hoverSV: SharedValue<number>
  active: SharedValue<boolean>
  setFrameActive: (on: boolean) => void
  measure: () => void
  begin: (a: Application) => void
  finish: (columnIndex: number) => void
  setHover: (i: number) => void
}

/**
 * A card that can be picked up.
 *
 * Each card builds its own `Gesture.Pan`. One shared instance across the board
 * looks like it would work and does not: a gesture object carries the handler
 * state for the touch it is tracking, so every card would be reporting on
 * whichever card was grabbed last.
 */
function DraggableCard({
  application: a,
  actions,
  ctl,
  dragging,
  onOpen,
}: {
  application: Application
  actions: RowActions
  ctl: DragControl
  dragging: boolean
  onOpen: (id: string) => void
}) {
  const drag = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(LIFT_DELAY)
        // Touch-down, ~LIFT_DELAY before activation — time enough for the async
        // measure to land before the first frame that needs it.
        .onBegin((e) => {
          ctl.grabX.value = e.x
          ctl.grabY.value = e.y
          runOnJS(ctl.measure)()
        })
        .onStart((e) => {
          ctl.pointerX.value = e.absoluteX
          ctl.pointerY.value = e.absoluteY
          ctl.active.value = true
          ctl.lift.value = withSpring(1, { damping: 18, stiffness: 240 })
          runOnJS(ctl.setFrameActive)(true)
          runOnJS(ctl.begin)(a)
        })
        .onUpdate((e) => {
          ctl.pointerX.value = e.absoluteX
          ctl.pointerY.value = e.absoluteY
          const local = e.absoluteX - ctl.wrapX.value + ctl.scrollX.value
          const idx = Math.min(STAGES.length - 1, Math.max(0, Math.floor(local / COLUMN_STRIDE)))
          // Only on change: this fires every frame, and setState must not.
          if (idx !== ctl.hoverSV.value) {
            ctl.hoverSV.value = idx
            runOnJS(ctl.setHover)(idx)
          }
        })
        .onEnd(() => {
          runOnJS(ctl.finish)(ctl.hoverSV.value)
        })
        // Fires on cancel as well as completion — a drag interrupted by a call
        // or a rotation has to put the board back the same way a drop does.
        .onFinalize(() => {
          ctl.active.value = false
          ctl.hoverSV.value = -1
          ctl.lift.value = withTiming(0, { duration: 140 })
          runOnJS(ctl.setFrameActive)(false)
        }),
    [a, ctl],
  )

  return (
    <GestureDetector gesture={drag}>
      <BoardCard
        application={a}
        actions={actions}
        state={dragging ? 'source' : 'idle'}
        onOpen={onOpen}
      />
    </GestureDetector>
  )
}

/**
 * The board, one column per stage, scrolled horizontally — and draggable.
 *
 * A drag inside a horizontal scroller is two gestures competing for one finger,
 * which is why this was a stage menu for so long. The long press is what
 * separates them: the board owns any touch that stays still for `LIFT_DELAY`,
 * and the scroller owns everything that moves before then. Neither has to guess
 * at direction, so a fast horizontal flick still scrolls and never picks a card
 * up by accident.
 *
 * Three things follow from that and all three are load-bearing:
 *
 * - The vertical scroller *above* this one is frozen for the duration
 *   (`onDragChange`), so the board cannot slide out from under the card while
 *   the finger is down and the measured origin stays valid.
 * - Near either edge the board scrolls itself, because a column four to the
 *   right is otherwise unreachable without letting go.
 * - The drop reuses `actions.onMoveStage` — the identical path the stage menu
 *   takes, so a dragged move gets the same confirmation sheet where the stage
 *   needs details, and the same undo toast. A drag is a new way to ask for a
 *   move, not a second implementation of one.
 *
 * The stage menu stays on every card. Drag is an addition, not a replacement:
 * it is unavailable to anyone driving this with a switch or a screen reader.
 */
export function Board({
  pool,
  actions,
  onOpen,
  onDragChange,
}: {
  pool: Application[]
  actions: RowActions
  onOpen: (id: string) => void
  /** Freezes the page scroller while a card is in the air. */
  onDragChange: (dragging: boolean) => void
}) {
  const c = useColors()
  const { open } = useSheets()

  const scroller = useAnimatedRef<Animated.ScrollView>()
  const wrap = useRef<View>(null)

  // Window coordinates of the board, captured on touch-down. The floating card
  // is positioned in this wrapper's space but the gesture reports the finger in
  // the window's, so one of the two has to be translated into the other.
  const wrapX = useSharedValue(0)
  const wrapY = useSharedValue(0)
  const viewportW = useSharedValue(0)
  const scrollX = useSharedValue(0)
  const pointerX = useSharedValue(0)
  const pointerY = useSharedValue(0)
  const grabX = useSharedValue(0)
  const grabY = useSharedValue(0)
  const lift = useSharedValue(0)
  const hoverSV = useSharedValue(-1)
  const active = useSharedValue(false)

  const [dragging, setDragging] = useState<Application | null>(null)
  const [hover, setHover] = useState(-1)

  // Read by the gesture, which is built once and must not capture a render's
  // values. `dragging` is the same card, kept where a callback can reach the
  // current one without being rebuilt every time it changes.
  const held = useRef<Application | null>(null)
  const latest = useRef({ actions, onDragChange })
  latest.current = { actions, onDragChange }

  const maxScroll = Math.max(0, STAGES.length * COLUMN_STRIDE - COLUMN_GAP + space[3] - 320)

  const measure = useCallback(() => {
    wrap.current?.measureInWindow((x, y) => {
      wrapX.value = x
      wrapY.value = y
    })
  }, [wrapX, wrapY])

  const begin = useCallback((a: Application) => {
    held.current = a
    setDragging(a)
    latest.current.onDragChange(true)
  }, [])

  const finish = useCallback((columnIndex: number) => {
    const card = held.current
    held.current = null
    setDragging(null)
    setHover(-1)
    latest.current.onDragChange(false)
    const target = STAGES[columnIndex]
    // `onMoveStage` no-ops when the stage is unchanged, so a drag that goes
    // nowhere — or is released over the column it started in — costs nothing.
    if (card && target) latest.current.actions.onMoveStage(card, target.id)
  }, [])

  const onScroll = useAnimatedScrollHandler((e) => {
    scrollX.value = e.contentOffset.x
  })

  // Edge auto-scroll. It has to run on the UI thread: driving it from JS means
  // the board lurches whenever a render lands, which is constantly, since the
  // hovered column is React state.
  const frame = useFrameCallback(() => {
    'worklet'
    if (!active.value) return
    const local = pointerX.value - wrapX.value
    let delta = 0
    if (local < EDGE) delta = -EDGE_SPEED
    else if (local > viewportW.value - EDGE) delta = EDGE_SPEED
    if (delta === 0) return
    scrollX.value = Math.min(maxScroll, Math.max(0, scrollX.value + delta))
    scrollTo(scroller, scrollX.value, 0, false)
  }, false)

  // Everything a card's gesture needs, in one stable object. Bundled so each
  // `DraggableCard` can memoise its gesture on a single dependency — a gesture
  // rebuilt mid-drag is a gesture that drops the finger.
  const ctl: DragControl = useMemo(
    () => ({
      wrapX,
      wrapY,
      viewportW,
      scrollX,
      pointerX,
      pointerY,
      grabX,
      grabY,
      lift,
      hoverSV,
      active,
      setFrameActive: frame.setActive,
      measure,
      begin,
      finish,
      setHover,
    }),
    [
      wrapX,
      wrapY,
      viewportW,
      scrollX,
      pointerX,
      pointerY,
      grabX,
      grabY,
      lift,
      hoverSV,
      active,
      frame.setActive,
      measure,
      begin,
      finish,
    ],
  )

  const floating = useAnimatedStyle(() => ({
    left: pointerX.value - wrapX.value - grabX.value,
    top: pointerY.value - wrapY.value - grabY.value,
    opacity: lift.value,
    transform: [{ scale: 0.96 + lift.value * 0.08 }, { rotate: `${lift.value * 1.5}deg` }],
  }))

  return (
    <View ref={wrap} collapsable={false} onLayout={measure}>
      <Animated.ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEnabled={!dragging}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onLayout={(e) => {
          viewportW.value = e.nativeEvent.layout.width
        }}
      >
        <View style={styles.board}>
          {STAGES.map((stage, i) => {
            const items = pool.filter((a) => a.stage === stage.id)
            const isTarget = dragging != null && hover === i && dragging.stage !== stage.id
            return (
              <View
                key={stage.id}
                style={[
                  styles.column,
                  {
                    backgroundColor: c.well,
                    borderColor: isTarget ? c.accent : c.hairline,
                  },
                  isTarget && styles.columnTarget,
                ]}
              >
                <View style={styles.columnHead}>
                  <View
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 3.5,
                      backgroundColor: c.stage[stage.id],
                    }}
                  />
                  <Txt size="xs" weight="medium" tone="secondary" style={s.fill} numberOfLines={1}>
                    {stage.label}
                  </Txt>
                  <Txt size="xs" tone="muted" mono>
                    {items.length}
                  </Txt>
                </View>

                {items.map((a) => (
                  <DraggableCard
                    key={a.id}
                    application={a}
                    actions={actions}
                    ctl={ctl}
                    dragging={dragging?.id === a.id}
                    onOpen={onOpen}
                  />
                ))}

                {/* Per column, so the stage is already chosen: logging a job you
                    have already interviewed for should not mean adding it as a
                    draft and then moving it four columns to the right. */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Add an application at ${stage.label}`}
                  onPress={() => open('application', { initial: { stage: stage.id } })}
                  style={[styles.addHere, { borderColor: c.hairlineStrong }]}
                >
                  <Feather name="plus" size={13} color={c.text3} />
                  <Txt size="xs" tone="muted">
                    Add here
                  </Txt>
                </Pressable>
              </View>
            )
          })}
        </View>
      </Animated.ScrollView>

      {dragging ? (
        <Animated.View style={[styles.floater, floating]} pointerEvents="none">
          <BoardCard application={dragging} actions={actions} state="floating" />
        </Animated.View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  board: { flexDirection: 'row', gap: COLUMN_GAP, paddingRight: space[3] },
  column: {
    width: COLUMN_W,
    gap: space[2],
    padding: space[2],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
  },
  // The drop target. A solid border rather than a tint, because the column is
  // already a tinted well and a second wash of colour on it read as disabled.
  columnTarget: { borderWidth: 1.5 },
  columnHead: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: 4 },
  card: {
    gap: space[1],
    padding: space[2.5],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
  },
  // Where the card came from. Kept in place at low opacity rather than removed,
  // so the column does not reflow the instant a drag starts — a board that
  // resettles under your finger makes the drop target a moving question.
  cardSource: { opacity: 0.25 },
  cardFloating: { borderWidth: 1.5, elevation: 12 },
  floater: { position: 'absolute', width: COLUMN_W - space[2] * 2 },
  addHere: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[1],
    minHeight: 40,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radius.md,
  },
})
