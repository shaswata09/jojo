import { useContext, useEffect, useRef, type ReactNode } from 'react'
import { View, type StyleProp, type ViewStyle } from 'react-native'
import { TourScrollContext, clearTarget, setTarget } from '@/components/tour/registry'

/**
 * Marks a control for the guided tour: the overlay can find it, light it and
 * read the value it reports. A plain wrapping View, `collapsable={false}` so
 * Android keeps a native view to measure — nothing about the control changes.
 */
export function TourTarget({
  id,
  state,
  style,
  children,
}: {
  id: string
  /** A value the tour can check — the view shown, the tool picked. */
  state?: string
  style?: StyleProp<ViewStyle>
  children: ReactNode
}) {
  const ref = useRef<View>(null)
  const scroller = useContext(TourScrollContext)
  useEffect(() => {
    const node = ref.current
    setTarget(id, { node, state, scroller })
    return () => clearTarget(id, node)
  }, [id, state, scroller])
  return (
    <View ref={ref} collapsable={false} style={style}>
      {children}
    </View>
  )
}
