import { useState } from 'react'
import type { ReactNode } from 'react'
import { Linking, Pressable, StyleSheet, Switch, TextInput, View } from 'react-native'
import type { StyleProp, TextInputProps, ViewStyle } from 'react-native'
import { Feather } from '@react-native-vector-icons/feather/static'
import { IconButton } from '@/components/ui/Button'
import { Txt } from '@/components/ui/Text'
import { openHref } from '@/lib/urls'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { fonts, radius, space, type } from '@/theme/tokens'

/**
 * A labelled slot for any control.
 *
 * Label, then the control, then a hint or an error underneath — never both, so
 * a field that has gone wrong says one thing rather than two. `required` draws
 * the marker the form's description promises.
 */
export function FormField({
  label,
  hint,
  error,
  required,
  children,
  style,
}: {
  label: string
  hint?: string
  error?: string
  required?: boolean
  children: ReactNode
  style?: StyleProp<ViewStyle>
}) {
  return (
    <View style={[styles.field, style]}>
      <View style={styles.labelRow}>
        <Txt size="xs" tone="secondary" weight="medium">
          {label}
        </Txt>
        {required ? (
          <Txt size="xs" tone="danger">
            {' *'}
          </Txt>
        ) : null}
      </View>
      {children}
      {error ? (
        <Txt size="xs" tone="danger" style={styles.hint}>
          {error}
        </Txt>
      ) : hint ? (
        <Txt size="xs" tone="muted" style={styles.hint}>
          {hint}
        </Txt>
      ) : null}
    </View>
  )
}

export type TextFieldProps = Omit<TextInputProps, 'style'> & {
  label: string
  hint?: string
  error?: string
  required?: boolean
  mono?: boolean
  style?: StyleProp<ViewStyle>
}

export function TextField({
  label,
  hint,
  error,
  required,
  mono,
  style,
  multiline,
  ...rest
}: TextFieldProps) {
  const c = useColors()
  const [focused, setFocused] = useState(false)

  /*
   * The button that opens what a URL field holds.
   *
   * A saved link sitting in a text box is somewhere you cannot go: on a phone,
   * visiting it means long-pressing, selecting, copying and pasting into a
   * browser. Four of those sit on the profile screen alone.
   *
   * It keys off `keyboardType` rather than a prop of its own — a field that
   * asks for the URL keyboard has already said the thing this needs to know, so
   * the affordance arrives on every URL field at once rather than wherever
   * somebody remembered to ask for it. `openHref` keeps it honest: an empty
   * field, a half-typed one, `localhost` and `javascript:` all produce no
   * button. Single-line only, because a multi-line field holds prose.
   */
  const href =
    rest.keyboardType === 'url' && !multiline ? openHref(String(rest.value ?? '')) : undefined

  return (
    <FormField label={label} hint={hint} error={error} required={required} style={style}>
      <View>
        <TextInput
          {...rest}
          multiline={multiline}
          placeholderTextColor={c.text3}
          onFocus={(e) => {
            setFocused(true)
            rest.onFocus?.(e)
          }}
          onBlur={(e) => {
            setFocused(false)
            rest.onBlur?.(e)
          }}
          style={[
            styles.input,
            {
              // A field that cannot be typed in has to look like one. RN dims the
              // text on neither platform, so an `editable={false}` field with the
              // same ink as the one above it reads as a field the user is failing
              // to focus rather than one that is waiting on something.
              color: rest.editable === false ? c.text3 : c.text1,
              backgroundColor: c.well,
              fontFamily: mono ? fonts.mono : fonts.regular,
              // The focus ring is the accent at full opacity. The web app
              // measured its old translucent ring at 2.97:1 and 1.83:1 — it
              // failed WCAG 1.4.11 in both themes, on every hand-rolled control.
              borderColor: error ? c.danger : focused ? c.accent : c.hairlineStrong,
              borderWidth: focused || error ? 1.5 : StyleSheet.hairlineWidth,
              minHeight: multiline ? 96 : 44,
              textAlignVertical: multiline ? 'top' : 'center',
              paddingTop: multiline ? space[2.5] : 0,
              // Conditional, because the button is: a URL field with nothing
              // openable in it must not sit indented for a control that is not
              // there.
              paddingRight: href ? 44 : space[3],
            },
          ]}
        />
        {href ? (
          <IconButton
            icon="external-link"
            label={`Open ${label}`}
            size={36}
            style={styles.open}
            onPress={() => {
              void Linking.openURL(href)
            }}
          />
        ) : null}
      </View>
    </FormField>
  )
}

/**
 * A setting and its control on one line, with room for a description.
 *
 * Named for what happens to the user's records rather than for the mechanism —
 * "Save as I work" describes the promise, "Auto sync" describes an
 * implementation, and only the first is a thing a person decides about.
 */
export function SettingRow({
  label,
  description,
  control,
  onPress,
}: {
  label: string
  description?: string
  control?: ReactNode
  onPress?: () => void
}) {
  const c = useColors()
  const body = (
    <View style={styles.settingRow}>
      <View style={s.fill}>
        <Txt size="base">{label}</Txt>
        {description ? (
          <Txt size="xs" tone="muted" style={{ marginTop: 2 }}>
            {description}
          </Txt>
        ) : null}
      </View>
      {control ? <View style={styles.settingControl}>{control}</View> : null}
      {onPress && !control ? <Feather name="chevron-right" size={18} color={c.text3} /> : null}
    </View>
  )

  if (!onPress) return body
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [pressed && { backgroundColor: c.rowHover, borderRadius: radius.md }]}
    >
      {body}
    </Pressable>
  )
}

/** The platform switch, tinted from the palette so it is not iOS green. */
export function Toggle({
  value,
  onValueChange,
  label,
}: {
  value: boolean
  onValueChange: (next: boolean) => void
  label: string
}) {
  const c = useColors()
  return (
    <Switch
      accessibilityLabel={label}
      value={value}
      onValueChange={onValueChange}
      trackColor={{ false: c.hairlineStrong, true: c.accent }}
      thumbColor={value ? c.accentFg : c.panel}
      ios_backgroundColor={c.hairlineStrong}
    />
  )
}

const styles = StyleSheet.create({
  field: { gap: space[1.5] },
  labelRow: { flexDirection: 'row', alignItems: 'center' },
  input: {
    borderRadius: radius.md,
    paddingHorizontal: space[3],
    paddingVertical: space[2.5],
    fontSize: type.base,
  },
  hint: { marginTop: 0 },
  // Centred against the input's 44pt minimum height.
  open: { position: 'absolute', right: 4, top: 4 },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[3],
    minHeight: 56,
  },
  settingControl: { flexShrink: 0 },
})
