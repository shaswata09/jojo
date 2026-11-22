import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Chip } from '@/components/ui/Chip'
import { Columns } from '@/components/ui/Screen'
import { Divider, Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { ThirdPartyNotices } from '@/screens/guide/ThirdPartyNotices'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'

/**
 * What this is made of, and what it deliberately is not.
 *
 * The web guide's equivalent page carries licences and a code tour. The tour
 * is kept short here for the reason the rest of the app is: a phone is not where
 * anyone reads a dependency list, and a page that pretends otherwise is a page
 * nobody scrolls. What survives the cut is the part a reader can act on —
 * which packages are load-bearing, and which claims in this build are honest
 * placeholders rather than finished features.
 *
 * The licences are NOT cut. The APK redistributes every package below and some
 * seven hundred more, and their licences ask for their notices to travel with
 * it — which, for an app, means inside it. They sit at the foot of the page in
 * one panel that opens the full list (`ThirdPartyNotices`), generated from the
 * installed packages rather than typed, so the page stays one screen long and
 * the notices stay complete.
 */

/** Package names stay as written; each `role` is a key under `builtWith.stack` in the guide catalog. */
const STACK: { name: string; role: string }[] = [
  { name: 'React Native 0.81', role: 'app' },
  // Was "Expo SDK 54 — fonts, clipboard, status bar". All three had stopped
  // being true: the faces are build-time assets, the clipboard is
  // @react-native-clipboard/clipboard, and the status bar is React Native's
  // own. Eleven ejection steps and a green gate all missed it, because nothing
  // in the toolchain can see a stale string inside a rendered array — and this
  // is the one the user reads.
  { name: 'React Native CLI', role: 'build' },
  { name: 'blob-util · documents', role: 'documents' },
  { name: 'React Navigation 7', role: 'navigation' },
  { name: 'Reanimated 4', role: 'drag' },
  { name: 'react-native-svg', role: 'charts' },
  { name: 'Inter · JetBrains Mono', role: 'type' },
  // Was missing while the app linked it: the Firebase SDKs (and Google's native
  // ones underneath) are in every build, whether or not anyone agreed to
  // reporting, so they belong on a list of what the app is made of.
  { name: 'React Native Firebase · Google Firebase SDKs', role: 'reporting' },
]

/** Keys under `builtWith.unfinished` in the guide catalog, each with a `title` and a `detail`. */
const UNFINISHED = ['assistant', 'scout', 'network'] as const

export function GuideBuiltWith() {
  const { t } = useTranslation('guide')
  const c = useColors()

  return (
    <>
      <Panel>
        <Txt size="sm" tone="secondary">
          {t('builtWith.intro')}
        </Txt>
      </Panel>

      <Columns>
        <Panel>
          <PanelTitle hint={t('builtWith.stackHint')}>{t('builtWith.stackTitle')}</PanelTitle>
          {STACK.map((row, i) => (
            <View key={row.name}>
              {i > 0 ? <Divider /> : null}
              <View style={{ paddingVertical: space[2.5] }}>
                <Txt size="sm" weight="medium">
                  {row.name}
                </Txt>
                <Txt size="xs" tone="muted" style={{ marginTop: 2 }}>
                  {t(`builtWith.stack.${row.role}`)}
                </Txt>
              </View>
            </View>
          ))}
        </Panel>

        <Panel style={{ borderColor: c.warningBorder }}>
          <PanelTitle hint={t('builtWith.unfinishedHint')}>
            {t('builtWith.unfinishedTitle')}
          </PanelTitle>
          <Txt size="xs" tone="muted" style={{ marginBottom: space[3] }}>
            {t('builtWith.unfinishedIntro')}
          </Txt>
          {UNFINISHED.map((row, i) => (
            <View key={row}>
              {i > 0 ? <Divider /> : null}
              <View style={{ paddingVertical: space[2.5] }}>
                <View style={s.row}>
                  <Chip size="sm" tone="amber">
                    {t('builtWith.placeholder')}
                  </Chip>
                  <Txt size="sm" weight="medium" style={s.fill}>
                    {t(`builtWith.unfinished.${row}.title`)}
                  </Txt>
                </View>
                <Txt size="xs" tone="muted" style={{ marginTop: space[1.5] }}>
                  {t(`builtWith.unfinished.${row}.detail`)}
                </Txt>
              </View>
            </View>
          ))}
        </Panel>
      </Columns>

      <ThirdPartyNotices />
    </>
  )
}
