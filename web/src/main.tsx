import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from '@/App'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { DialogHost, DialogsProvider } from '@/lib/dialogs'
import { LabelsProvider } from '@/lib/labels'
import { ModelSettingsProvider } from '@/lib/model-settings'
import { MascotProvider } from '@/lib/mascot'
import { RolesProvider } from '@/lib/roles'
import { StoreProvider } from '@/lib/store'
import { ThemeProvider } from '@/lib/theme'
import { ToastProvider } from '@/lib/toast'

const container = document.getElementById('root')
if (!container) throw new Error('Root element #root not found in index.html')

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
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
                      <App />
                      <DialogHost />
                    </MascotProvider>
                  </DialogsProvider>
                </ModelSettingsProvider>
              </LabelsProvider>
            </StoreProvider>
          </ToastProvider>
        </RolesProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
)
