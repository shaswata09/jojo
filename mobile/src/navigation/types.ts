import type { NavigatorScreenParams } from '@react-navigation/native'
import type { Stage } from '@jojo/service/data/seed'

/**
 * The five tools the Vault holds. Kept here rather than in the screen so a
 * navigation call can name one without importing a screen module.
 */
export const VAULT_TOOLS = ['reminders', 'links', 'files', 'snippets', 'people', 'tools'] as const
export type VaultTool = (typeof VAULT_TOOLS)[number]

export type TabParamList = {
  Today: undefined
  /**
   * `stage` opens the list already filtered — the glance counters use it.
   *
   * `shared` is a URL or a scrap of text handed over by the Android share
   * sheet. The screen opens the create sheet on it and clears the parameter, so
   * it is a one-shot instruction rather than a filter.
   */
  Applications:
    { stage?: Stage | 'all'; sort?: 'stage' | 'daysAgo' | 'role'; shared?: string } | undefined
  /** `date` opens on a specific day, `focus` lights up one item on it. */
  Calendar: { date?: string; focus?: string } | undefined
  Vault: { tool?: VaultTool; focus?: string } | undefined
  More: undefined
}

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList>
  ApplicationDetail: { id: string }
  /** `key` is the employer's slug, or a NodeId from an older link. */
  Organisation: { key: string }
  Search: undefined
  JobScout: { focus?: { kind: 'match' | 'posting'; id: string } } | undefined
  Statistics: undefined
  Profile: undefined
  Assistant: undefined
  Settings: undefined
  Guide: undefined
  Graph: undefined
  Transfer: undefined
  /**
   * The in-app browser, and the only screen that reaches the network.
   *
   * `url` is where to open; `applicationId` is what a capture taken here gets
   * filed under, passed in because this screen has no way to work it out — it is
   * reached from an application's own detail screen, which knows.
   */
  PostingBrowser: { url: string; applicationId?: string }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
