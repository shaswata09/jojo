import { useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AccessibilityInfo, Animated, StyleSheet, View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { FocusScopeContext } from '@/components/ui/focus-scope'
import { useColors } from '@/theme/theme-context'
import { radius } from '@/theme/tokens'

/**
 * Rows and panels a search result can land on.
 *
 * Search lists every setting, but a setting is a row halfway down a long
 * screen: opening Settings at the top and leaving the reader to hunt for
 * "Theme" is the same failure as not finding it at all. So a row marked with
 * `FocusTarget` registers with the screen it is drawn in, and a screen that
 * arrives with a `focus` scrolls that row into view and lights it briefly.
 *
 * `Screen` is the scope: it owns the ScrollView, so it is the only thing that
 * can measure a row against the scroll content and move to it. A target
 * outside any `Screen` (a sheet, say) renders as a plain wrapper and does
 * nothing.
 */

/** Faded in, held, faded out; still and briefer under reduced motion. */
const FADE_IN_MS = 180
const HOLD_MS = 1400
const FADE_OUT_MS = 600
const STILL_MS = 1800

/**
 * Marks a row or panel as a place search can land.
 *
 * A plain wrapping View — `collapsable={false}` so Android keeps a native view
 * to measure — plus, while lit, a ring and a faint tint drawn over it. Over,
 * not behind: a panel paints its own background, so a tint behind it would
 * never be seen. The overlay takes no touches.
 */
export function FocusTarget({
  id,
  style,
  children,
}: {
  /** A dotted path, listed in `lib/search-places.ts`. */
  id: string
  style?: StyleProp<ViewStyle>
  children: ReactNode
}) {
  const scope = useContext(FocusScopeContext)
  const c = useColors()
  const ref = useRef<View>(null)
  const glow = useRef(new Animated.Value(0)).current
  /** Set by an arrival; a fresh object each time, so a second one relights. */
  const [lit, setLit] = useState<{ reduced: boolean } | null>(null)

  useEffect(() => {
    if (!scope) return
    return scope.register(id, () => {
      void AccessibilityInfo.isReduceMotionEnabled()
        .catch(() => false)
        .then((reduced) => {
          const node = ref.current
          if (node) scope.reveal(node, reduced)
          setLit({ reduced })
        })
    })
  }, [scope, id])

  // Run once the overlay is mounted, so the animation has a view to drive.
  useEffect(() => {
    if (!lit) return
    if (lit.reduced) {
      glow.setValue(1)
      const still = setTimeout(() => setLit(null), STILL_MS)
      return () => clearTimeout(still)
    }
    glow.setValue(0)
    const flash = Animated.sequence([
      Animated.timing(glow, { toValue: 1, duration: FADE_IN_MS, useNativeDriver: true }),
      Animated.delay(HOLD_MS),
      Animated.timing(glow, { toValue: 0, duration: FADE_OUT_MS, useNativeDriver: true }),
    ])
    flash.start(({ finished }) => {
      if (finished) setLit(null)
    })
    return () => flash.stop()
  }, [lit, glow])

  return (
    <View ref={ref} collapsable={false} style={style}>
      {children}
      {lit ? (
        <Animated.View style={[StyleSheet.absoluteFill, styles.overlay, { opacity: glow }]}>
          <View style={[StyleSheet.absoluteFill, styles.tint, { backgroundColor: c.accentSoft }]} />
          <View style={[StyleSheet.absoluteFill, styles.ring, { borderColor: c.accent }]} />
        </Animated.View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  overlay: { pointerEvents: 'none' },
  tint: { opacity: 0.35, borderRadius: radius.lg },
  ring: { borderWidth: 1.5, borderRadius: radius.lg },
})
