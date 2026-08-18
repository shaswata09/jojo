# The five faces, vendored

Copied verbatim out of `@expo-google-fonts/inter` and
`@expo-google-fonts/jetbrains-mono` at the versions in that commit's
`package-lock.json`, and **not modified**. They used to be fetched at runtime by
`expo-font`; they are linked into the app now.

They live in `mobile/android/app/src/main/assets/fonts/`, because that is the
only place Android looks. The Xcode project references _those_ files rather than
keeping a second copy — five binaries no diff can review are bad enough once.

This note is here rather than beside them because everything under
`src/main/assets/` is packaged into the APK, and a README does not belong in
the app people install.

## The filenames are the PostScript names, and that is the whole trick

Android's `ReactFontManager` resolves `fontFamily` against the **asset filename**
with the extension dropped: `fonts/<fontFamily>.ttf`. iOS resolves against a
family name first and, when no family matches, falls back to `UIFont(name:)`,
which accepts a **PostScript name**.

Those two rules have exactly one string in common per face — the PostScript
name — so the files were renamed to it and `mobile/src/theme/tokens.ts` says it
five times:

| file                        | family (`name` ID 1) | PostScript (`name` ID 6) |
| --------------------------- | -------------------- | ------------------------ |
| `Inter-Regular.ttf`         | `Inter`              | `Inter-Regular`          |
| `Inter-Medium.ttf`          | `Inter Medium`       | `Inter-Medium`           |
| `Inter-SemiBold.ttf`        | `Inter SemiBold`     | `Inter-SemiBold`         |
| `Inter-Bold.ttf`            | `Inter`              | `Inter-Bold`             |
| `JetBrainsMono-Regular.ttf` | `JetBrains Mono`     | `JetBrainsMono-Regular`  |

Rename a file here without changing `tokens.ts` and Android silently falls back
to the platform face. Rename it to something that is not a PostScript name and
iOS does the same.

The files were previously named `Inter_400Regular.ttf` and so on — the
`@expo-google-fonts` package convention, which matched nothing on iOS.

## Why not `fontFamily: 'Inter'` plus `fontWeight`

Because these particular files do not support it, and that was measured rather
than assumed. Only Regular and Bold declare the family `Inter`. Medium and
SemiBold declare themselves as the families `Inter Medium` and `Inter SemiBold`;
`Inter` is only their _typographic_ family (`name` ID 16), which is not what
CoreText groups by.

So `[UIFont fontNamesForFamilyName:@"Inter"]` returns two faces, Regular and
Bold. `RCTFontWithFontProperties` then picks the nearest weight among _those_:
ask for 500 or 600 and you get Bold. Medium and SemiBold would render one and
two steps too heavy, in an app whose type scale was tuned by eye.

## Registering them on iOS

Two things, and neither is optional:

- The five file references are in **Copy Bundle Resources** in
  `mobile/ios/jojo.xcodeproj`, pointing at the Android assets directory.
- Every filename is listed under **`UIAppFonts`** in `mobile/ios/jojo/Info.plist`,
  alongside `Feather.ttf`. Copying a font into the bundle does not register it;
  `UIAppFonts` is what does. `Feather.ttf` arrives differently — the
  `@react-native-vector-icons/feather` podspec declares it as a pod resource —
  but it still needs the same `Info.plist` entry, which it did not have under
  Expo because `expo-font` registered it at runtime instead.

## Not verified

Nothing here has run on an iPhone or a simulator. The resolution rules above are
read out of `RCTFontUtils.mm` and each font's `name` table; what has not been
observed is the app rendering. The check, when there is a Mac with Xcode: open
any screen and confirm the four Inter weights are visibly distinct and that the
Calculator's figures are monospaced. San Francisco has four distinct weights too,
so "it looks fine" is not the test — compare against the Android build.
