import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { AppShell } from '@/components/layout/AppShell'
import { Applications } from '@/routes/Applications'
import { Assistant } from '@/routes/Assistant'
import { Calendar } from '@/routes/Calendar'
import { Dashboard } from '@/routes/Dashboard'
import { Guide } from '@/routes/Guide'
import { JobScout } from '@/routes/JobScout'
import { Placeholder } from '@/routes/Placeholder'
import { Profile } from '@/routes/Profile'
import { Vault } from '@/routes/Vault'
import { Settings } from '@/routes/Settings'
import { Statistics } from '@/routes/Statistics'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Dashboard />} />
          <Route path="applications" element={<Applications />} />
          <Route path="calendar" element={<Calendar />} />
          <Route path="vault" element={<Vault />} />
          {/* Reminders became one tool inside the Vault. Kept as a redirect so
              bookmarks and anything still pointing here keep working. */}
          <Route path="reminders" element={<Navigate to="/vault" replace />} />
          <Route path="scout" element={<JobScout />} />
          <Route path="statistics" element={<Statistics />} />
          <Route path="profile" element={<Profile />} />
          <Route path="assistant" element={<Assistant />} />
          <Route
            path="chat"
            element={
              <Placeholder
                title="Chat"
                subtitle="Conversations with recruiters and search chairs, kept alongside the application they belong to."
              />
            }
          />
          <Route path="settings" element={<Settings />} />
          <Route path="guide" element={<Guide />} />
          <Route
            path="*"
            element={<Placeholder title="Not found" subtitle="That page does not exist." />}
          />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
