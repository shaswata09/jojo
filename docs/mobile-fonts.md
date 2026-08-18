# The five faces, vendored

Copied verbatim out of `@expo-google-fonts/inter` and
`@expo-google-fonts/jetbrains-mono` at the versions in that commit's
`package-lock.json`, and **not modified**. They used to be fetched at runtime by
`expo-font`; they are linked into the app now.

They live in `mobile/android/app/src/main/assets/fonts/`, because that is the
only place Android looks. When iOS is done they will be added to the Xcode
project as a reference to *those* files rather than copied again — five
binaries no diff can review are bad enough once.

This note is here rather than beside them because everything under
`src/main/assets/` is packaged into the APK, and a README does not belong in
the app people install.

## Why the filenames matter

Android's `ReactFontManager` resolves `fontFamily` against the **asset
filename** with the extension dropped. That is the whole reason
`src/theme/tokens.ts` did not have to change: `fontFamily: 'Inter_500Medium'`
finds `Inter_500Medium.ttf` and every one of the app's `fontFamily:` call sites
keeps working untouched. Rename a file here and the text silently falls back to
the platform face.

## iOS does not resolve them, and this was measured, not guessed

iOS resolves a font by family name or by PostScript name. Neither matches the
filename for any of the five — read straight out of each `name` table:

| file | family | PostScript |
|---|---|---|
| `Inter_400Regular.ttf` | `Inter` | `Inter-Regular` |
| `Inter_500Medium.ttf` | `Inter Medium` | `Inter-Medium` |
| `Inter_600SemiBold.ttf` | `Inter SemiBold` | `Inter-SemiBold` |
| `Inter_700Bold.ttf` | `Inter` | `Inter-Bold` |
| `JetBrainsMono_400Regular.ttf` | `JetBrains Mono` | `JetBrainsMono-Regular` |

So on iOS all five `fontFamily` strings currently resolve to nothing and the
app renders in San Francisco — silently, with a green test suite, and with
every panel's measured layout slightly wrong.

This is **known and deferred on purpose**, to the iOS steps, at a simulator
where it can be seen rather than argued about. The two routes are written up in
`docs/EXPO-REMOVAL.md`: rewrite `tokens.ts` to `fontFamily: 'Inter'` plus
`fontWeight` (idiomatic, but it re-tunes every weight and reaches into design
tokens that are marked settled), or patch these five `name` tables so the
PostScript name equals the filename (keeps `tokens.ts` byte-identical). If the
patch route is taken it must ship as a committed, re-runnable script — losing
it would make five unreviewable binaries unreproducible.
