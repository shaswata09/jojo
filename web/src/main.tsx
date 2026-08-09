import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from '@/App'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { DialogHost, DialogsProvider } from '@/lib/dialogs'
import { LabelsProvider } from '@/lib/labels'
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
          <LabelsProvider>
            {/* Toasts outside the store: an undo has to stay on screen after
                the write that raised it, and often after the route has gone. */}
            <ToastProvider>
              <StoreProvider>
                <DialogsProvider>
                  <MascotProvider>
                    <App />
                    <DialogHost />
                  </MascotProvider>
                </DialogsProvider>
              </StoreProvider>
            </ToastProvider>
          </LabelsProvider>
        </RolesProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
)
