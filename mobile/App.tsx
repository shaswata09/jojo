import { useEffect, useRef } from 'react'
import { StatusBar, StyleSheet, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { LocaleProvider } from '@/i18n/LocaleProvider'
import { reconcileTrashedDocuments, vanishedDocuments } from '@/lib/documents'
import { useGraph, useKg } from '@jojo/service/react/kg-context'
import { useStoreStatus } from '@jojo/service/react/status-context'
import { reportError } from '@/lib/report-error'
import { LabelsProvider } from '@/lib/labels'
import { RolesProvider } from '@/lib/roles'
import { SheetsProvider } from '@/lib/sheets'
import { ModelSettingsProvider } from '@/lib/model-settings'
import { AgentRunsProvider } from '@jojo/service/react/agent-runs-provider'
import { AppJobsProvider } from '@/lib/jobs'
import { ApprovalSheet } from '@/components/assistant/ApprovalSheet'
import { PipelinesProvider } from '@/lib/pipelines'
import { StoreProvider } from '@/lib/store'
import { ToastProvider } from '@/lib/toast'
import { RootNavigator } from '@/navigation'
import { SheetHost } from '@/sheets/SheetHost'
import { TourOverlay } from '@/components/tour/TourOverlay'
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
 * Records ARE persisted — the graph lives in AsyncStorage behind
 * `createRnDriver`, so a restart keeps everything. This paragraph used to say
 * the opposite, from when the phone app was a prototype over `useState`.
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
      {/* Outside every provider on purpose. Both apps mount the same shared
          hooks, and a throw out of one of them used to leave the phone with a
          blank frame and no way back — in a release build there is no red box
          and no console. It renders in plain React Native primitives so that a
          failure in ThemeProvider cannot take the error screen down with it. */}
      <ErrorBoundary>
        <LocaleProvider>
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
                          <AppJobsProvider>
                            <AgentRunsProvider
                              onError={(e) => {
                                reportError('agent', e)
                              }}
                            >
                              {/* Above the navigator too: a pipeline that stopped
                              when you left Job Scout was a pipeline that did not
                              do what its own footer said. */}
                              <PipelinesProvider>
                                <Themed />
                              </PipelinesProvider>
                            </AgentRunsProvider>
                          </AppJobsProvider>
                        </SheetsProvider>
                      </LabelsProvider>
                    </StoreProvider>
                  </ModelSettingsProvider>
                </ToastProvider>
              </RolesProvider>
            </ThemeProvider>
          </SafeAreaProvider>
        </LocaleProvider>
      </ErrorBoundary>
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
      <DocumentTrash />
      {/* Beside the sheet host, outside the navigator: an approval for a run
          whose screen has been popped has nowhere else to be drawn. */}
      <ApprovalSheet />
      {/* Above everything, beside the navigator for the same reason: the
          guided tour walks from screen to screen and must outlive each one. */}
      <TourOverlay />
    </View>
  )
}

/**
 * The documents set aside by a delete, kept in line with the records.
 *
 * `trashDocument` moves a deleted file's bytes rather than unlinking them, so an
 * Undo can put them back. This used to delete everything set aside, once, at
 * launch, on the reasoning that the undo ring is in memory so nothing could ask
 * for them again — but Settings › Audit log › Undo last and the assistant's Undo
 * revert from the persisted journal, and only the toast moved the bytes back.
 * The record came back; the next launch deleted its document (health-1).
 *
 * So: on every change to the records, a set-aside copy whose record exists again
 * is moved back, whichever Undo ran. Once per launch, and only once the store
 * has hydrated from disk, copies no record names are deleted if they were set
 * aside more than `TRASH_RETENTION_MS` ago — an in-memory store after a failed
 * boot names none, and must not read as "all deleted"; and the audit log can
 * Undo a delete from an earlier launch.
 *
 * And the other direction: a document whose record left WITHOUT the row's
 * delete — the assistant's `vault.file.delete`, Undo last of an upload, a
 * restore that dropped it — used to stay in the sandbox for good, because only
 * the row called `trashDocument`. Each commit is compared with the previous
 * one (`vanishedDocuments`), and a path it named that no record names now is
 * set aside the same way, so the same machinery brings it back or sweeps it.
 * The baseline is the first HYDRATED commit: before that the graph is not the
 * person's records, and "gone from it" means nothing.
 *
 * Its own component, rendering nothing, so a commit re-renders this and not the
 * navigator. Never rejects: a leaked copy is a few kilobytes.
 */
function DocumentTrash() {
  const { boot } = useStoreStatus()
  const { projections } = useKg()
  const files = projections.files(useGraph())
  const hydrated = boot.phase === 'ready'
  const swept = useRef(false)
  /** The uris the last hydrated commit named; null until there was one. */
  const named = useRef<readonly (string | undefined)[] | null>(null)
  useEffect(() => {
    const sweep = hydrated && !swept.current
    if (sweep) swept.current = true
    const uris = files.map((f) => f.uri)
    const vanished =
      hydrated && named.current !== null ? vanishedDocuments(named.current, uris) : []
    named.current = hydrated ? uris : null
    void reconcileTrashedDocuments(uris, { sweep, hydrated, vanished })
  }, [files, hydrated])
  return null
}

const styles = StyleSheet.create({
  root: { flex: 1 },
})
