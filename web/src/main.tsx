import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from '@/App'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { LocaleProvider } from '@/i18n/LocaleProvider'
import { reportError } from '@/lib/report-error'
import { startOffline } from '@/lib/offline'
import { AgentRunsProvider } from '@jojo/service/react/agent-runs-provider'
import { AppJobsProvider } from '@/lib/jobs'
import { ApprovalHost } from '@/components/assistant/ApprovalHost'
import { DialogHost, DialogsProvider } from '@/lib/dialogs'
import { LabelsProvider } from '@/lib/labels'
import { PipelinesProvider } from '@/lib/pipelines'
import { McpLinkProvider } from '@/lib/mcp-link-provider'
import { ModelSettingsProvider } from '@/lib/model-settings'
import { MascotProvider } from '@/lib/mascot'
import { RolesProvider } from '@/lib/roles'
import { StoreProvider } from '@/lib/store'
import { ThemeProvider } from '@/lib/theme'
import { ToastProvider } from '@/lib/toast'
import { report } from '@/lib/analytics'

const container = document.getElementById('root')
if (!container) throw new Error('Root element #root not found in index.html')

/*
 * Installed before the app mounts, so a crash during boot is caught too.
 *
 * ONE pair of listeners. `listenForCrashes` used to be installed here as well,
 * and both pairs recorded every uncaught error — `reportError` records too —
 * so each crash was written twice, halving the history Settings keeps and
 * doubling its count. `reportError` does all three jobs: the console, the
 * crash record (only when the build allows it and the person opted in, see
 * `core/crash-config.ts`) and the analytics event.
 */
/*
 * The two failures the error boundary cannot see.
 *
 * A boundary catches a throw during RENDER. It does nothing about a rejected
 * promise nobody awaited, and there are ~56 deliberately fire-and-forget
 * promises in `web/src` — every rejection out of one was discarded in silence.
 * With no backend and no crash reporter, the console is the only diagnostic
 * this product has, so the least it can do is write to it.
 *
 * Reporting, not recovering: by the time a rejection is unhandled the work is
 * already lost. `preventDefault` is deliberately NOT called, so the browser
 * still logs its own richer trace underneath.
 */
window.addEventListener('unhandledrejection', (event) => {
  reportError('unhandled_rejection', event.reason)
})

window.addEventListener('error', (event) => {
  // Resource load failures (a missing image) arrive here with no `error`.
  // Those are not bugs worth a line; a real uncaught exception is.
  if (event.error) reportError('uncaught', event.error, { fatal: true })
})

/*
 * The denominator for every other number.
 *
 * Sent once per page load, before the app mounts, and — like every event —
 * only when the build allows analytics and the person using it has said yes.
 * Without it a rise in "vault opened" cannot be told apart from a rise in
 * people opening jojo at all.
 */
report('app_opened', {})

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      {/* Outermost after the boundary: every provider below may say
          something on screen, and all of it is in the chosen language. */}
      <LocaleProvider>
        <ThemeProvider>
          <RolesProvider>
            {/* Toasts outside the store: an undo has to stay on screen after
              the write that raised it, and often after the route has gone —
              and the store's own ⌘Z handler fires one, so it needs this. */}
            <ToastProvider>
              <StoreProvider>
                {/* Keywords moved INTO the store (D14), so this provider now sits
                  inside it rather than above it. It holds one thing: which
                  chips the filter has lit, which is UI state and belongs to
                  this tab rather than to the records. */}
                <LabelsProvider>
                  {/* Outside the store on purpose: an endpoint describes this
                    machine's network, not the user's records, so it must not
                    travel with a Transfer. See `model-settings-context`. */}
                  <ModelSettingsProvider>
                    <DialogsProvider>
                      <MascotProvider>
                        {/* Above the router, which starts inside `App`.
                          A conversation's run is keyed by which conversation it
                          is and has to outlive the page that started it — the
                          same reason the toasts and the dialog host are up here.
                          `ApprovalHost` is a sibling of `DialogHost` for the
                          sharper version of that reason: a destructive step
                          reached after the user walked away has to be
                          answerable from wherever they are, or the run waits
                          forever and the exchange is never saved. */}
                        <AppJobsProvider>
                          <AgentRunsProvider
                            onError={(e) => {
                              reportError('agent', e)
                            }}
                          >
                            {/* Above the router too, and for the same reason: a
                            pipeline that stopped when you left Job Scout was a
                            pipeline that did not do what its own caption said. */}
                            <PipelinesProvider>
                              {/* Up here with the pipelines, for the same reason:
                              a link that lived on the Settings page would stop
                              answering Claude Code the moment you went to look
                              at what it had just changed. */}
                              <McpLinkProvider>
                                <App />
                                <DialogHost />
                                <ApprovalHost />
                              </McpLinkProvider>
                            </PipelinesProvider>
                          </AgentRunsProvider>
                        </AppJobsProvider>
                      </MascotProvider>
                    </DialogsProvider>
                  </ModelSettingsProvider>
                </LabelsProvider>
              </StoreProvider>
            </ToastProvider>
          </RolesProvider>
        </ThemeProvider>
      </LocaleProvider>
    </ErrorBoundary>
  </StrictMode>,
)

/*
 * Last, and deliberately.
 *
 * The install fetches the whole precache list; starting it before React has the
 * page would put that in front of the first paint, trading a slower start for an
 * offline copy nobody needs in the first two seconds.
 */
startOffline()
