import { StatusBar, StyleSheet, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { LabelsProvider } from '@/lib/labels'
import { RolesProvider } from '@/lib/roles'
import { SheetsProvider } from '@/lib/sheets'
import { ModelSettingsProvider } from '@/lib/model-settings'
import { AgentRunsProvider } from '@jojo/service/react/agent-runs-provider'
import { ApprovalSheet } from '@/components/assistant/ApprovalSheet'
import { PipelinesProvider } from '@/lib/pipelines'
import { StoreProvider } from '@/lib/store'
import { ToastProvider } from '@/lib/toast'
import { RootNavigator } from '@/navigation'
import { SheetHost } from '@/sheets/SheetHost'
import { ThemeProvider } from '@/theme/theme'
import { useTheme } from '@/theme/theme-context'

/**
 * jojo — Jarvis fOr Job Organization, on a phone.
 *
 * The provider order is load-bearing and matches the web app's:
 *
 *   Theme → Roles → Labels → Toast → Store → Sheets
 *
 * Toasts sit OUTSIDE the store because an undo has to stay on screen after the
 * write that raised it, and often after the screen it came from has gone. The
 * store sits inside Labels because deleting an application also has to drop
 * that application's keywords — the reducer cannot do it, since keywords live in
 * a provider above it and are not part of `StoreState`.
 *
 * Nothing is persisted and nothing is fetched. A restart is the reset button;
 * Settings is where you switch between the demo records and an empty store.
 *
 * THE FONTS ARE NOT LOADED HERE ANY MORE, AND NOTHING REPLACED THAT CODE.
 * `useFonts` fetched five TTFs at runtime and this function held the first
 * frame back until they arrived — every panel is measured against Inter's
 * metrics, so painting in the platform face first was a layout that visibly
 * resettled. The five files are linked into the app now, present before the
 * first frame exists, so the gate had nothing left to gate and the blank frame
 * it showed is gone with it.
 */
export default function App() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <ThemeProvider>
          <RolesProvider>
            <ToastProvider>
              <ModelSettingsProvider>
                <StoreProvider>
                  {/* Inside the store, because keywords are records now. They
                      used to be `useState` in this provider — a second set
                      beside the graph's own, which meant the seven keyword
                      tools were unreachable and nothing you tagged survived a
                      restart. `useKeywords` is the graph's, so this provider
                      keeps only the filter selection, which is view state. */}
                  <LabelsProvider>
                    <SheetsProvider>
                      {/* Above the navigator, which `Themed` renders. A
                          conversation's run has to outlive the screen that
                          started it, and every exit from the Assistant screen
                          pops it — it is always the leaf of the stack. */}
                      <AgentRunsProvider>
                        {/* Above the navigator too: a pipeline that stopped
                            when you left Job Scout was a pipeline that did not
                            do what its own footer said. */}
                        <PipelinesProvider>
                          <Themed />
                        </PipelinesProvider>
                      </AgentRunsProvider>
                    </SheetsProvider>
                  </LabelsProvider>
                </StoreProvider>
              </ModelSettingsProvider>
            </ToastProvider>
          </RolesProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

/**
 * Inside the theme, so the status bar can follow it.
 *
 * `SheetHost` is mounted beside the navigator rather than inside it: a sheet is
 * not a route, and putting it under a screen would tear it down the moment the
 * screen that opened it navigated away.
 */
function Themed() {
  const { theme, colors } = useTheme()

  return (
    <View style={[styles.root, { backgroundColor: colors.page }]}>
      {/* Dynamic, and it has to stay dynamic. `light-content` means light
          GLYPHS, which is what a dark page needs; hardcoding it — the obvious
          reading of expo-status-bar's `style="light"` — leaves the light theme
          with a white bar full of white icons and no error anywhere. */}
      <StatusBar barStyle={theme === 'dark' ? 'light-content' : 'dark-content'} />
      <RootNavigator />
      <SheetHost />
      {/* Beside the sheet host, outside the navigator: an approval for a run
          whose screen has been popped has nowhere else to be drawn. */}
      <ApprovalSheet />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
})
