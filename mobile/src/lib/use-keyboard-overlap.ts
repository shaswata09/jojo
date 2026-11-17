import { useCallback, useEffect, useRef, useState } from 'react'
import { Keyboard, Platform } from 'react-native'
import type { View } from 'react-native'
import { keyboardOverlap } from '@/lib/keyboard-overlap'

/**
 * How much of a view the on-screen keyboard covers, in dp, for that view to pad
 * itself by.
 *
 * Android stopped doing this for the app. With `edgeToEdgeEnabled` (target SDK
 * 36), both the activity and every `Modal`'s dialog window are set not to fit
 * system windows, and from API 30 such a window is not resized for the IME —
 * `adjustResize` in the manifest has no effect. React Native reads the IME
 * insets only to emit `keyboardDidShow`/`keyboardDidHide`. So a form sheet's
 * footer and the Assistant's composer sat under the keyboard.
 *
 * Why not `KeyboardAvoidingView` with `behavior="padding"`, which `Sheet` used
 * on iOS: on Android its `keyboardDidHide` handling measures against
 * `mVisibleViewArea.height()` and leaves the status and nav bar heights behind
 * as padding once the keyboard closes, and it reads its own frame relative to
 * its parent, which is wrong by the header's height under a stack header. This
 * measures the view in window coordinates, the same space the keyboard's
 * `screenY` is in, and goes to zero on hide.
 *
 * Pass `ref` to the view and `onLayout` to its `onLayout`; pad its bottom by
 * `overlap`. Padding never changes the view's own frame, so the measurement is
 * stable while the padding is applied.
 */
export function useKeyboardOverlap() {
  const ref = useRef<View>(null)
  const [overlap, setOverlap] = useState(0)
  /** The keyboard's top edge in window coordinates, or null while it is down. */
  const top = useRef<number | null>(null)

  const measure = useCallback(() => {
    const edge = top.current
    if (edge === null) {
      setOverlap(0)
      return
    }
    ref.current?.measureInWindow((_x, y, _width, height) =>
      setOverlap(keyboardOverlap(y, height, edge)),
    )
  }, [])

  useEffect(() => {
    const ios = Platform.OS === 'ios'
    const shown = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (event) => {
      top.current = event.endCoordinates.screenY
      measure()
    })
    const hidden = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => {
      top.current = null
      setOverlap(0)
    })
    // A keyboard already up when this mounts — a sheet opened from a focused
    // field — would otherwise go unnoticed until it moved.
    const metrics = Keyboard.isVisible() ? Keyboard.metrics() : undefined
    if (metrics) {
      top.current = metrics.screenY
      measure()
    }
    return () => {
      shown.remove()
      hidden.remove()
    }
  }, [measure])

  return { ref, overlap, onLayout: measure }
}
