import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from '@/App'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { LabelsProvider } from '@/lib/labels'
import { MascotProvider } from '@/lib/mascot'
import { RolesProvider } from '@/lib/roles'
import { ThemeProvider } from '@/lib/theme'

const container = document.getElementById('root')
if (!container) throw new Error('Root element #root not found in index.html')

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <RolesProvider>
          <LabelsProvider>
            <MascotProvider>
              <App />
            </MascotProvider>
          </LabelsProvider>
        </RolesProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
)
