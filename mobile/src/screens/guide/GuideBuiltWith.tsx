import { View } from 'react-native'
import { Chip } from '@/components/ui/Chip'
import { Columns } from '@/components/ui/Screen'
import { Divider, Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'

/**
 * What this is made of, and what it deliberately is not.
 *
 * The web guide's equivalent page carries licences and a code tour. Both are
 * kept short here for the reason the rest of the app is: a phone is not where
 * anyone reads a dependency list, and a page that pretends otherwise is a page
 * nobody scrolls. What survives the cut is the part a reader can act on —
 * which packages are load-bearing, and which claims in this build are honest
 * placeholders rather than finished features.
 */

const STACK: { name: string; role: string }[] = [
  { name: 'React Native 0.81', role: 'The app itself, on both platforms' },
  // Was "Expo SDK 54 — fonts, clipboard, status bar". All three had stopped
  // being true: the faces are build-time assets, the clipboard is
  // @react-native-clipboard/clipboard, and the status bar is React Native's
  // own. Eleven ejection steps and a green gate all missed it, because nothing
  // in the toolchain can see a stale string inside a rendered array — and this
  // is the one the user reads.
  { name: 'React Native CLI', role: 'The build. No Expo — we own android/ and ios/' },
  { name: 'blob-util · documents', role: 'Attaching a file, and opening it again' },
  { name: 'React Navigation 7', role: 'The tab bar and the screen stack' },
  { name: 'Reanimated 4', role: "The board's long-press drag, on the UI thread" },
  { name: 'react-native-svg', role: 'The donut, the radar and the graph' },
  { name: 'Inter · JetBrains Mono', role: 'The type, bundled rather than fetched' },
]

const UNFINISHED: { title: string; detail: string }[] = [
  {
    title: 'The assistant has no model',
    detail:
      'Every reply is one of five worked examples, and each carries a badge saying so. Connect a local model in Settings and the panel says what it would take.',
  },
  {
    title: 'The scout finds nothing on its own',
    detail:
      'Fit percentages are real — computed on this device against the match terms, target roles and regions on your profile, and they say what they matched. What is missing is the crawl: nothing goes out and looks for postings, so the feed only holds what you put in it.',
  },
  {
    title: 'Nothing leaves this device',
    detail:
      'There is no account, no sync and no upload. The one network call the app can make is to the model you point it at in Settings, and it goes to that address and nowhere else.',
  },
]

export function GuideBuiltWith() {
  const c = useColors()

  return (
    <>
      <Panel>
        <Txt size="sm" tone="secondary">
          An interactive prototype of the same product as the web app, sharing every module with a
          rule in it — the date arithmetic, the statistics funnel, the keyword system and the seed —
          so the two cannot disagree about a date, a rate or a stage.
        </Txt>
      </Panel>

      <Columns>
        <Panel>
          <PanelTitle hint="what is actually running">Built with</PanelTitle>
          {STACK.map((row, i) => (
            <View key={row.name}>
              {i > 0 ? <Divider /> : null}
              <View style={{ paddingVertical: space[2.5] }}>
                <Txt size="sm" weight="medium">
                  {row.name}
                </Txt>
                <Txt size="xs" tone="muted" style={{ marginTop: 2 }}>
                  {row.role}
                </Txt>
              </View>
            </View>
          ))}
        </Panel>

        <Panel style={{ borderColor: c.warningBorder }}>
          <PanelTitle hint="stated, not hidden">What is still a placeholder</PanelTitle>
          <Txt size="xs" tone="muted" style={{ marginBottom: space[3] }}>
            A prototype that hides its edges is a prototype that gets believed. These three are the
            ones worth knowing before you judge anything else on screen.
          </Txt>
          {UNFINISHED.map((row, i) => (
            <View key={row.title}>
              {i > 0 ? <Divider /> : null}
              <View style={{ paddingVertical: space[2.5] }}>
                <View style={s.row}>
                  <Chip size="sm" tone="amber">
                    placeholder
                  </Chip>
                  <Txt size="sm" weight="medium" style={s.fill}>
                    {row.title}
                  </Txt>
                </View>
                <Txt size="xs" tone="muted" style={{ marginTop: space[1.5] }}>
                  {row.detail}
                </Txt>
              </View>
            </View>
          ))}
        </Panel>
      </Columns>
    </>
  )
}
