import { useEffect, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  Animated,
  BackHandler,
  Easing,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@react-native-vector-icons/feather/static'
import { Button } from '@/components/ui/Button'
import { Txt } from '@/components/ui/Text'
import { getTarget } from '@/components/tour/registry'
import { TOUR_STEPS, type TourRoute } from '@/components/tour/steps'
import { finishTour, goToStep, leaveTour, useTourState } from '@/components/tour/store'
import {
  isDone,
  needsRoute,
  placeCard,
  scrollNeeded,
  tabSlot,
  visiblePart,
  type Box,
} from '@/components/tour/tour-logic'
import { StackActions } from '@react-navigation/native'
import { navigationRef } from '@/navigation/ref'
import type { TabParamList } from '@/navigation/types'
import { useColors } from '@/theme/theme-context'
import { radius, space } from '@/theme/tokens'

/** The tour's one colour: the orange of jojo's body, as on the web. */
const TOUR = '#e2772f'
const TOUR_SOFT = 'rgba(226,119,47,0.14)'
/** Around the lit control. */
const PAD = 6
/** How often the lit control is re-measured and the task re-checked, ms. */
const TICK_MS = 160
/** How long a ticked task shows its tick before the tour moves on, ms. */
const ADVANCE_MS = 900

const TABS: readonly string[] = ['Today', 'Applications', 'Calendar', 'Vault', 'More']

/**
 * Opens a screen, whether it is a tab or a screen of the root stack.
 *
 * A tab goes BACK to the tab screens with `popTo` rather than `navigate`:
 * since React Navigation 7, `navigate` no longer returns to a screen already
 * in the stack, so from How to use it pushed a second copy of the tabs on top,
 * with a back arrow leading to the first.
 */
function open(route: TourRoute): void {
  if (!navigationRef.isReady()) return
  if (TABS.includes(route)) {
    navigationRef.dispatch(StackActions.popTo('Tabs', { screen: route as keyof TabParamList }))
  } else {
    // The stack screens the tour opens take no parameters.
    ;(navigationRef.navigate as (name: string) => void)(route)
  }
}

const currentRoute = (): string | undefined =>
  navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : undefined

/** A view's box in window coordinates, or null when it has no size. */
function windowBox(node: View | null | undefined): Promise<Box | null> {
  if (!node) return Promise.resolve(null)
  return new Promise((resolve) => {
    node.measureInWindow((x, y, width, height) =>
      resolve(width && height ? { x, y, width, height } : null),
    )
  })
}

/**
 * Where a target is, in the overlay's own coordinates; null when it is not
 * mounted or not measurable.
 *
 * Measured against the overlay's root rather than taken as is: on Android,
 * edge to edge, `measureInWindow` can report from below the status bar while
 * the overlay draws from the top of the screen, and the ring sat a status bar
 * too high. Measuring both the same way and subtracting cancels whatever
 * offset the platform applies.
 */
async function measure(id: string | undefined, root: View | null): Promise<Box | null> {
  if (!id) return null
  const tab = id.startsWith('tab:') ? id.slice(4) : null
  const [box, origin] = await Promise.all([
    windowBox(getTarget(tab ? 'tabbar' : id)?.node),
    windowBox(root),
  ])
  if (!box) return null
  const local = { ...box, x: box.x - (origin?.x ?? 0), y: box.y - (origin?.y ?? 0) }
  return tab ? tabSlot(local, tab) : local
}

/**
 * The tour on screen: the app dimmed, a lit cut-out around the control the
 * step is about, and a card saying what it is — and, for a hands-on step,
 * what to try. Mounted beside the navigator (App.tsx), above every screen,
 * so it survives the screen changes the tour makes; it reaches the navigator
 * only through `navigationRef`, since `useNavigation` throws out here.
 *
 * Only the lit control takes touches while one is lit, so "Open Applications"
 * cannot be answered by wandering elsewhere. Next always works, so no task
 * can strand anyone; Android's back button ends the tour and keeps the place.
 */
export function TourOverlay() {
  const tour = useTourState()
  if (!tour.active) return null
  return <Walk index={tour.step} />
}

function Walk({ index }: { index: number }) {
  const c = useColors()
  const insets = useSafeAreaInsets()
  const view = useWindowDimensions()
  const step = TOUR_STEPS[index] ?? TOUR_STEPS[0]!
  const last = index === TOUR_STEPS.length - 1

  const [rect, setRect] = useState<Box | null>(null)
  const [cardHeight, setCardHeight] = useState(240)
  const [doneFor, setDoneFor] = useState<string | null>(null)
  const done = doneFor === step.id
  /**
   * The step whose task was done WHILE IT WAS SHOWING — seen undone, then
   * done. Only that moves the tour on. A task already true when its step
   * opens (Back onto "Open Applications" from the Applications tab) shows as
   * done and waits for Next, or Back would bounce straight forward again.
   */
  const [advanceFor, setAdvanceFor] = useState<string | null>(null)
  const [reduced, setReduced] = useState(false)
  const pulse = useRef(new Animated.Value(0)).current
  const rootRef = useRef<View>(null)

  const next = () => (last ? finishTour() : goToStep(index + 1))

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduced)
  }, [])

  // A new step: open its screen. Keyed on the step alone — re-running on a
  // screen change would drag a reader back who had already moved on.
  useEffect(() => {
    if (needsRoute(step, currentRoute()) && step.route) open(step.route)
  }, [step])

  // Measure, scroll into view once, and check the task — on a short beat, for
  // as long as the step is up. The control can move: a screen pushing in, a
  // list loading, the scroll the line below asks for.
  useEffect(() => {
    let alive = true
    let scrolled = false
    let ticked = false
    let seenUndone = false
    // A fresh visit to the step: an advance earned on an earlier visit (the
    // task done, then Back to it) must not fire again.
    setAdvanceFor(null)
    const tick = async () => {
      const whole = await measure(step.target, rootRef.current)
      if (!alive) return
      // Clipped to what is on screen: above the tab bar, below the status bar
      // — unless the target IS a tab.
      const isTab = step.target?.startsWith('tab:') ?? false
      const bar = isTab || !whole ? null : await measure('tabbar', rootRef.current)
      const box =
        whole && !isTab
          ? visiblePart(whole, insets.top, bar ? bar.y : view.height - insets.bottom)
          : whole
      // Scrolled by the WHOLE control: one below the fold has no visible part.
      if (whole && !scrolled && step.target && !isTab) {
        scrolled = true
        const dy = scrollNeeded(whole, { height: view.height, top: insets.top })
        const scroller = getTarget(step.target)?.scroller
        if (dy !== 0 && scroller) scroller.scrollBy(dy)
      }
      setRect((prev) =>
        prev &&
        box &&
        Math.abs(prev.x - box.x) < 0.5 &&
        Math.abs(prev.y - box.y) < 0.5 &&
        Math.abs(prev.width - box.width) < 0.5 &&
        Math.abs(prev.height - box.height) < 0.5
          ? prev
          : box,
      )
      if (step.task && !ticked) {
        const now = isDone(step.task.done, {
          route: currentRoute(),
          state: (target) => getTarget(target)?.state,
        })
        if (!now) seenUndone = true
        else {
          ticked = true
          setDoneFor(step.id)
          if (seenUndone) setAdvanceFor(step.id)
        }
      }
    }
    void tick()
    const timer = setInterval(() => void tick(), TICK_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [step, view.height, insets.top, insets.bottom])

  // Done while showing: a moment to see the tick, then on.
  const advance = advanceFor === step.id
  useEffect(() => {
    if (!advance) return
    const t = setTimeout(() => (last ? finishTour() : goToStep(index + 1)), ADVANCE_MS)
    return () => clearTimeout(t)
  }, [advance, index, last])

  // Android's back button leaves the tour (the place is kept) rather than
  // navigating underneath it.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      leaveTour()
      return true
    })
    return () => sub.remove()
  }, [])

  // The ring breathes so the eye finds it; still under reduced motion.
  useEffect(() => {
    if (reduced) return
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1600,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    )
    loop.start()
    return () => loop.stop()
  }, [pulse, reduced])

  const lit = rect
    ? {
        x: rect.x - PAD,
        y: rect.y - PAD,
        width: rect.width + PAD * 2,
        height: rect.height + PAD * 2,
      }
    : null
  // Touches reach only the lit control — unless nothing is lit and the step
  // asks the reader to go and do something, which needs the screen.
  const shield = lit !== null || !step.task
  const cardWidth = Math.min(380, view.width - space[3] * 2)
  const place = placeCard(
    lit,
    { width: cardWidth, height: cardHeight },
    { width: view.width, height: view.height, top: insets.top, bottom: insets.bottom },
  )
  const dim = 'rgba(0,0,0,0.58)'
  const panes: Box[] = lit
    ? [
        { x: 0, y: 0, width: view.width, height: Math.max(0, lit.y) },
        {
          x: 0,
          y: lit.y + lit.height,
          width: view.width,
          height: Math.max(0, view.height - lit.y - lit.height),
        },
        { x: 0, y: lit.y, width: Math.max(0, lit.x), height: lit.height },
        {
          x: lit.x + lit.width,
          y: lit.y,
          width: Math.max(0, view.width - lit.x - lit.width),
          height: lit.height,
        },
      ]
    : [{ x: 0, y: 0, width: view.width, height: view.height }]

  return (
    <View
      ref={rootRef}
      collapsable={false}
      style={StyleSheet.absoluteFill}
      pointerEvents="box-none"
    >
      {panes.map((b, i) => (
        <View
          key={i}
          pointerEvents={shield ? 'auto' : 'none'}
          style={{
            position: 'absolute',
            left: b.x,
            top: b.y,
            width: b.width,
            height: b.height,
            backgroundColor: dim,
          }}
        />
      ))}

      {lit ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: lit.x,
            top: lit.y,
            width: lit.width,
            height: lit.height,
            borderRadius: radius.lg,
            borderWidth: 2,
            borderColor: TOUR,
          }}
        >
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              {
                borderRadius: radius.lg,
                borderWidth: 2,
                borderColor: TOUR,
                opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] }),
                transform: [
                  { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) },
                ],
              },
            ]}
          />
        </View>
      ) : null}

      <View
        accessibilityViewIsModal
        onLayout={(e) => setCardHeight(e.nativeEvent.layout.height)}
        style={{
          position: 'absolute',
          left: place.left,
          top: place.top,
          width: cardWidth,
          backgroundColor: c.panel,
          borderRadius: radius.xl,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: c.hairline,
          padding: space[4],
          gap: space[2],
          elevation: 12,
          shadowColor: '#000',
          shadowOpacity: 0.35,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
        }}
      >
        <View style={styles.headRow}>
          <Txt size="xs" tone="muted">
            Step {index + 1} of {TOUR_STEPS.length}
          </Txt>
          <Button label="End tour" variant="ghost" size="sm" onPress={leaveTour} />
        </View>
        <View style={[styles.track, { backgroundColor: c.hairline }]}>
          <View
            style={[
              styles.bar,
              { width: `${((index + 1) / TOUR_STEPS.length) * 100}%`, backgroundColor: TOUR },
            ]}
          />
        </View>
        <Txt size="lg" weight="semibold" heading accessibilityLiveRegion="polite">
          {step.title}
        </Txt>
        <Txt size="sm" tone="secondary">
          {step.body}
        </Txt>
        {step.task ? (
          <View
            accessibilityLiveRegion="polite"
            style={[
              styles.task,
              { borderColor: done ? TOUR : 'rgba(226,119,47,0.45)', backgroundColor: TOUR_SOFT },
            ]}
          >
            {done ? (
              <Feather name="check" size={16} color={TOUR} />
            ) : (
              <View style={[styles.dot, { backgroundColor: TOUR }]} />
            )}
            <Txt size="sm" weight="medium" color={done ? TOUR : undefined} style={styles.fill}>
              {done ? 'Nice — that’s it.' : `Try it: ${step.task.say}`}
            </Txt>
          </View>
        ) : null}
        <View style={styles.footRow}>
          {index > 0 ? (
            <Button label="Back" variant="ghost" size="md" onPress={() => goToStep(index - 1)} />
          ) : (
            <Button label="Not now" variant="ghost" size="md" onPress={leaveTour} />
          )}
          <Button
            label={last ? 'Finish' : step.task && !done ? 'Skip this' : 'Next'}
            size="md"
            onPress={next}
          />
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  footRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space[1],
  },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  bar: { height: 4, borderRadius: 2 },
  task: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  fill: { flex: 1 },
})
