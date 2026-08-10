import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { IconButton } from '@/components/ui/Button'
import { Txt } from '@/components/ui/Text'
import { useLayout } from '@/lib/use-layout'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { radius, space } from '@/theme/tokens'

/**
 * The one overlay shape in the app.
 *
 * Everything the web version puts in a centred dialog arrives from the bottom
 * here, because that is where the thumb is and because a form that has to hold
 * a keyboard needs the room above it rather than around it. The backdrop and
 * the hardware Back button both dismiss, which is the same three-way contract
 * the web app gives Escape, the backdrop and Cancel — the close is never
 * blocked, only made reversible by the toast the caller raises.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  /** A sheet holding a long form wants the whole screen; a menu wants its content. */
  size = 'auto',
}: {
  open: boolean
  onClose: () => void
  title?: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'auto' | 'tall'
}) {
  const c = useColors()
  const insets = useSafeAreaInsets()
  const { landscape } = useLayout()
  const enter = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!open) {
      enter.setValue(0)
      return
    }
    Animated.spring(enter, {
      toValue: 1,
      useNativeDriver: true,
      damping: 22,
      stiffness: 260,
      mass: 0.8,
    }).start()
  }, [open, enter])

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={[styles.root, landscape && styles.rootCentred]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: c.scrim }]}
        />

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[styles.keyboard, landscape && styles.cardWrap]}
          pointerEvents="box-none"
        >
          <Animated.View
            style={[
              styles.sheet,
              size === 'tall' && styles.tall,
              landscape && styles.card,
              {
                backgroundColor: c.panel,
                borderColor: c.hairline,
                // The notch swings to the side in landscape, and the sheet is
                // the one surface that reaches every edge.
                paddingLeft: Math.max(space[4], insets.left),
                paddingRight: Math.max(space[4], insets.right),
                // A bottom-anchored sheet clears the nav bar; a centred card is
                // nowhere near it.
                paddingBottom: landscape ? space[4] : insets.bottom + space[3],
                opacity: enter,
                transform: [
                  { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) },
                ],
              },
            ]}
          >
            <View style={[styles.grabber, { backgroundColor: c.hairlineStrong }]} />

            {title ? (
              <View style={styles.header}>
                <View style={s.fill}>
                  <Txt size="lg" weight="semibold">
                    {title}
                  </Txt>
                  {description ? (
                    <Txt size="sm" tone="muted" style={{ marginTop: space[1] }}>
                      {description}
                    </Txt>
                  ) : null}
                </View>
                <IconButton icon="x" label="Close" onPress={onClose} />
              </View>
            ) : null}

            {/* `flexShrink` is what makes the sheet's `maxHeight` bite. Without
                it the body takes its content height, the sheet is capped, and
                the overflow simply paints outside the rounded edge — which is
                exactly what a long menu did in landscape, where the cap is a
                third of the height it is in portrait. */}
            <View style={size === 'tall' ? styles.bodyTall : styles.body}>{children}</View>

            {footer ? (
              <View style={[styles.footer, { borderTopColor: c.hairline }]}>{footer}</View>
            ) : null}
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  keyboard: { justifyContent: 'flex-end' },
  // Landscape. A phone on its side has ~390pt of height, so a sheet rising from
  // the bottom edge covers nearly all of it and stops reading as a sheet — it
  // reads as the screen, with a seam across the top. With that little room the
  // honest shape is a centred card: same content, same three ways to dismiss it,
  // no pretence about sliding up from anywhere.
  rootCentred: { justifyContent: 'center' },
  // The side inset lives on the parent, not the card: `width: '100%'` resolves
  // against the parent's content box, so a margin here would be added on top of
  // a width that already filled it and push the card off both edges.
  cardWrap: { justifyContent: 'center', paddingHorizontal: space[4] },
  card: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 640,
    borderRadius: radius.xl,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    paddingHorizontal: space[4],
    paddingTop: space[2],
    maxHeight: '92%',
    // Belt to the flexShrink braces. Android does not clip a child to its
    // parent's bounds by default, so without this a body that still manages to
    // exceed the cap would draw straight through the rounded corner.
    overflow: 'hidden',
  },
  tall: { height: '92%' },
  body: { flexShrink: 1, minHeight: 0 },
  bodyTall: { flex: 1, minHeight: 0 },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: space[3],
    opacity: 0.6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[3],
    marginBottom: space[4],
  },
  footer: {
    flexDirection: 'row',
    // Wraps rather than overflowing: the draft sheet's footer carries three
    // buttons, and at 360pt the third would run off the edge of the sheet.
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: space[2],
    paddingTop: space[3],
    marginTop: space[3],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
})
