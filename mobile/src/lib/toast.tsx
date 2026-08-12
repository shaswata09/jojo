import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ToastContext as KgToastContext } from '@/kg/react/toast'
import type { ToastContextValue as KgToastContextValue } from '@/kg/react/toast'
import type { ReactNode } from 'react'
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  TOAST_ACTION_DURATION_MS,
  TOAST_DURATION_MS,
  TOAST_LIMIT,
  ToastContext,
} from '@/lib/toast-context'
import type { Toast, ToastOptions } from '@/lib/toast-context'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { fonts, radius, space, type } from '@/theme/tokens'

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback((options: ToastOptions) => {
    seq.current += 1
    const id = `t${seq.current}`
    setToasts((prev) => [...prev, { ...options, id }].slice(-TOAST_LIMIT))
    return id
  }, [])

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss])

  /**
   * The same provider, seen through the graph layer's port.
   *
   * `kg/react/toast.ts` declares what the graph needs a platform to be able to
   * say, and `KgProvider` and `useTool` read it — so the tool runtime's own
   * toasts (a write failed, a change was adopted) go through here rather than
   * through a second stack nobody styled.
   *
   * The one difference is the action's callback name: the port says `onClick`,
   * because it was cut from the web app where that is what a button does. This
   * app says `onPress`, because that is what a button does here, and thirty call
   * sites already say it. Renaming them to satisfy a port would put the wrong
   * word on every touch handler in the app to spare one adapter three lines, so
   * the adapter takes the three lines.
   */
  const kgValue = useMemo<KgToastContextValue>(
    () => ({
      toast: (options) =>
        toast({
          ...options,
          action: options.action
            ? { label: options.action.label, onPress: options.action.onClick }
            : undefined,
        }),
      dismiss,
    }),
    [toast, dismiss],
  )

  return (
    <ToastContext.Provider value={value}>
      <KgToastContext.Provider value={kgValue}>
        {children}
        <ToastViewport toasts={toasts} onDismiss={dismiss} />
      </KgToastContext.Provider>
    </ToastContext.Provider>
  )
}

/**
 * The stack, pinned above the tab bar rather than below the header.
 *
 * Bottom rather than top because the thumb is there: an Undo the user has to
 * reach the top of the screen for is one they will not press in the eight
 * seconds it is up.
 */
function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[]
  onDismiss: (id: string) => void
}) {
  const insets = useSafeAreaInsets()

  if (toasts.length === 0) return null

  return (
    <View
      pointerEvents="box-none"
      style={[styles.viewport, { bottom: insets.bottom + space[12] + space[4] }]}
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </View>
  )
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const c = useColors()
  const enter = useRef(new Animated.Value(0)).current
  const danger = toast.tone === 'danger'

  useEffect(() => {
    Animated.spring(enter, {
      toValue: 1,
      useNativeDriver: true,
      damping: 18,
      stiffness: 220,
      mass: 0.7,
    }).start()

    const timer = setTimeout(onDismiss, toast.action ? TOAST_ACTION_DURATION_MS : TOAST_DURATION_MS)
    return () => clearTimeout(timer)
    // The timer is set once per toast; `onDismiss` is stable per id.
  }, [enter, onDismiss, toast.action])

  return (
    <Animated.View
      style={[
        styles.card,
        {
          backgroundColor: c.raised,
          borderColor: danger ? c.dangerBorder : c.hairline,
          opacity: enter,
          transform: [
            { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
          ],
        },
      ]}
      accessibilityLiveRegion={danger ? 'assertive' : 'polite'}
    >
      <View style={s.fill}>
        <Text style={[styles.title, { color: danger ? c.danger : c.text1 }]} numberOfLines={2}>
          {toast.title}
        </Text>
        {toast.description ? (
          <Text style={[styles.description, { color: c.text3 }]} numberOfLines={3}>
            {toast.description}
          </Text>
        ) : null}
      </View>

      {toast.action ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            toast.action?.onPress()
            onDismiss()
          }}
          style={({ pressed }) => [
            styles.action,
            {
              borderColor: c.hairlineStrong,
              backgroundColor: pressed ? c.rowHover : 'transparent',
            },
          ]}
        >
          <Text style={[styles.actionLabel, { color: c.text1 }]}>{toast.action.label}</Text>
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          onPress={onDismiss}
          style={styles.action}
        >
          <Text style={[styles.actionLabel, { color: c.text3 }]}>Close</Text>
        </Pressable>
      )}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  viewport: {
    position: 'absolute',
    left: space[3],
    right: space[3],
    gap: space[2],
    zIndex: 100,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingVertical: space[3],
    paddingLeft: space[3.5],
    paddingRight: space[2],
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  title: { fontFamily: fonts.medium, fontSize: type.sm, lineHeight: 18 },
  description: { fontFamily: fonts.regular, fontSize: type.xs, lineHeight: 16, marginTop: 2 },
  action: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: space[3],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  actionLabel: { fontFamily: fonts.medium, fontSize: type.sm },
})
