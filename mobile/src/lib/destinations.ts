import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import type { FeatherName } from '@/lib/timeline-visuals'
import type { RootStackParamList, VaultTool } from '@/navigation/types'

/** The navigator every screen in the app is pushed onto. */
type Nav = NativeStackNavigationProp<RootStackParamList>

/**
 * Every screen in the app, as a list you can search.
 *
 * The web app's ⌘K palette ends with a "Go to" group holding one row per page,
 * and it is the half of the palette people actually reach for: typing three
 * letters of a screen's name is faster than remembering which tab hides it. On
 * a phone the tab bar covers five destinations and the other nine live behind
 * More, which makes the same shortcut worth more here, not less.
 *
 * The Vault's five tools are listed individually rather than as one "Vault"
 * row. They are what a reader is actually looking for — nobody searches for
 * "vault", they search for "snippets" — and each is addressable, so a row can
 * land on the right tab rather than the tool the Vault happened to open on.
 *
 * Deliberately not a route table. `navigation/index.tsx` owns the routes; this
 * owns their *names*, which is a different thing that changes for different
 * reasons — a screen can be renamed in the UI without its route moving.
 */

export type Destination = {
  id: string
  label: string
  /** Searched alongside the label, so "keywords" finds Settings. */
  hint: string
  icon: FeatherName
  go: (nav: Nav) => void
}

const tab = (screen: 'Today' | 'Applications' | 'Calendar' | 'More') => (nav: Nav) =>
  nav.navigate('Tabs', { screen })

const vault = (tool: VaultTool) => (nav: Nav) =>
  nav.navigate('Tabs', { screen: 'Vault', params: { tool } })

const push =
  (screen: keyof Omit<RootStackParamList, 'Tabs' | 'ApplicationDetail' | 'JobScout'>) =>
  (nav: Nav) =>
    nav.navigate(screen)

export const DESTINATIONS: Destination[] = [
  { id: 'd-today', label: 'Today', hint: 'What needs a decision', icon: 'sun', go: tab('Today') },
  {
    id: 'd-apps',
    label: 'Applications',
    hint: 'The list and the stage board',
    icon: 'clipboard',
    go: tab('Applications'),
  },
  {
    id: 'd-cal',
    label: 'Calendar',
    hint: 'Deadlines, interviews and prep',
    icon: 'calendar',
    go: tab('Calendar'),
  },
  {
    id: 'd-reminders',
    label: 'Reminders',
    hint: 'Vault · what you owe and when',
    icon: 'bell',
    go: vault('reminders'),
  },
  {
    id: 'd-links',
    label: 'Links',
    hint: 'Vault · postings, people and pages',
    icon: 'link-2',
    go: vault('links'),
  },
  {
    id: 'd-files',
    label: 'Files',
    hint: 'Vault · documents you have recorded',
    icon: 'file-text',
    go: vault('files'),
  },
  {
    id: 'd-snippets',
    label: 'Snippets',
    hint: 'Vault · reusable paragraphs',
    icon: 'scissors',
    go: vault('snippets'),
  },
  {
    id: 'd-tools',
    label: 'Tools',
    hint: 'Vault · the calculator',
    icon: 'grid',
    go: vault('tools'),
  },
  {
    id: 'd-scout',
    label: 'Job scout',
    hint: 'Saved searches, matches and postings',
    icon: 'radio',
    go: (nav) => nav.navigate('JobScout'),
  },
  {
    id: 'd-stats',
    label: 'Statistics',
    hint: 'Rates, a funnel and what to work on',
    icon: 'bar-chart-2',
    go: push('Statistics'),
  },
  {
    id: 'd-graph',
    label: 'Graph',
    hint: 'Your records as the network they are',
    icon: 'share-2',
    go: push('Graph'),
  },
  {
    id: 'd-profile',
    label: 'My profile',
    hint: 'Basics, documents and match terms',
    icon: 'user',
    go: push('Profile'),
  },
  {
    id: 'd-assistant',
    label: 'Assistant',
    hint: 'Worked examples until a model is connected',
    icon: 'message-square',
    go: push('Assistant'),
  },
  {
    id: 'd-settings',
    label: 'Settings',
    hint: 'Connections, appearance, keywords and your data',
    icon: 'settings',
    go: push('Settings'),
  },
  {
    id: 'd-transfer',
    label: 'Transfer',
    hint: 'Move everything to another device',
    icon: 'smartphone',
    go: push('Transfer'),
  },
  {
    id: 'd-guide',
    label: 'How to use',
    hint: 'The three layers, the screens and the graph',
    icon: 'help-circle',
    go: push('Guide'),
  },
  { id: 'd-more', label: 'More', hint: 'The rest of jojo', icon: 'grid', go: tab('More') },
]
