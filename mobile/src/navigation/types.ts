import type { NavigatorScreenParams } from '@react-navigation/native'
import type { Stage } from '@jojo/service/data/seed'

/**
 * The five tools the Vault holds. Kept here rather than in the screen so a
 * navigation call can name one without importing a screen module.
 */
export const VAULT_TOOLS = ['reminders', 'links', 'files', 'snippets', 'tools'] as const
export type VaultTool = (typeof VAULT_TOOLS)[number]

export type TabParamList = {
  Today: undefined
  /** `stage` opens the list already filtered — the glance counters use it. */
  Applications: { stage?: Stage | 'all'; sort?: 'stage' | 'daysAgo' | 'role' } | undefined
  /** `date` opens on a specific day, `focus` lights up one item on it. */
  Calendar: { date?: string; focus?: string } | undefined
  Vault: { tool?: VaultTool; focus?: string } | undefined
  More: undefined
}

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList>
  ApplicationDetail: { id: string }
  Search: undefined
  JobScout: { focus?: { kind: 'match' | 'posting'; id: string } } | undefined
  Statistics: undefined
  Profile: undefined
  Assistant: undefined
  Settings: undefined
  Guide: undefined
  Graph: undefined
  Transfer: undefined
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
