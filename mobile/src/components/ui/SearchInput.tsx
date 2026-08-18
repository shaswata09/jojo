import { StyleSheet, TextInput, View } from 'react-native'
import { Feather } from '@react-native-vector-icons/feather/static'
import { IconButton } from '@/components/ui/Button'
import { useColors } from '@/theme/theme-context'
import { fonts, radius, space, type } from '@/theme/tokens'

/** The one search field shape, wherever a list is filtered by typing. */
export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
  autoFocus,
}: {
  value: string
  onChange: (next: string) => void
  placeholder: string
  label: string
  autoFocus?: boolean
}) {
  const c = useColors()

  return (
    <View style={[styles.wrap, { backgroundColor: c.well, borderColor: c.hairline }]}>
      <Feather name="search" size={16} color={c.text3} />
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={c.text3}
        autoCorrect={false}
        autoCapitalize="none"
        autoFocus={autoFocus}
        returnKeyType="search"
        style={[styles.input, { color: c.text1 }]}
      />
      {value.length > 0 ? (
        <IconButton icon="x" label="Clear search" size={32} onPress={() => onChange('')} />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingLeft: space[3],
    paddingRight: space[1],
    height: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
  },
  input: { flex: 1, minWidth: 0, fontFamily: fonts.regular, fontSize: type.base, padding: 0 },
})
