import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import type { FeatherName } from '@/lib/timeline-visuals'
import type { RootStackParamList, VaultTool } from '@/navigation/types'
import { i18next } from '@/i18n/i18n'

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

/*
 * The screens you can simply go to, which is the ones that need no parameters.
 * `PostingBrowser` joins the excluded list for the same reason
 * `ApplicationDetail` is on it: it opens a specific URL, so "go there" is not a
 * destination anybody can search for — it is an action taken from a record that
 * already knows which address it means. `Organisation` is excluded on the same
 * grounds: there is no "the employer screen", only one employer's.
 */
const push =
  (
    screen: keyof Omit<
      RootStackParamList,
      'Tabs' | 'ApplicationDetail' | 'JobScout' | 'PostingBrowser' | 'Organisation'
    >,
  ) =>
  (nav: Nav) =>
    nav.navigate(screen)

/** Read when the row is drawn, so it follows the language jojo is in. */
const text = (id: string, field: 'label' | 'hint') =>
  i18next.t(`messages:destinations.${id}.${field}`)

export const DESTINATIONS: Destination[] = [
  {
    id: 'd-today',
    get label() {
      return text('today', 'label')
    },
    get hint() {
      return text('today', 'hint')
    },
    icon: 'sun',
    go: tab('Today'),
  },
  {
    id: 'd-apps',
    get label() {
      return text('apps', 'label')
    },
    get hint() {
      return text('apps', 'hint')
    },
    icon: 'clipboard',
    go: tab('Applications'),
  },
  {
    id: 'd-cal',
    get label() {
      return text('cal', 'label')
    },
    get hint() {
      return text('cal', 'hint')
    },
    icon: 'calendar',
    go: tab('Calendar'),
  },
  {
    id: 'd-reminders',
    get label() {
      return text('reminders', 'label')
    },
    get hint() {
      return text('reminders', 'hint')
    },
    icon: 'bell',
    go: vault('reminders'),
  },
  {
    id: 'd-links',
    get label() {
      return text('links', 'label')
    },
    get hint() {
      return text('links', 'hint')
    },
    icon: 'link-2',
    go: vault('links'),
  },
  {
    id: 'd-files',
    get label() {
      return text('files', 'label')
    },
    get hint() {
      return text('files', 'hint')
    },
    icon: 'file-text',
    go: vault('files'),
  },
  {
    id: 'd-snippets',
    get label() {
      return text('snippets', 'label')
    },
    get hint() {
      return text('snippets', 'hint')
    },
    icon: 'scissors',
    go: vault('snippets'),
  },
  {
    id: 'd-tools',
    get label() {
      return text('tools', 'label')
    },
    get hint() {
      return text('tools', 'hint')
    },
    icon: 'grid',
    go: vault('tools'),
  },
  {
    id: 'd-scout',
    get label() {
      return text('scout', 'label')
    },
    get hint() {
      return text('scout', 'hint')
    },
    icon: 'radio',
    go: (nav) => nav.navigate('JobScout'),
  },
  {
    id: 'd-stats',
    get label() {
      return text('stats', 'label')
    },
    get hint() {
      return text('stats', 'hint')
    },
    icon: 'bar-chart-2',
    go: push('Statistics'),
  },
  {
    id: 'd-graph',
    get label() {
      return text('graph', 'label')
    },
    get hint() {
      return text('graph', 'hint')
    },
    icon: 'share-2',
    go: push('Graph'),
  },
  {
    id: 'd-profile',
    get label() {
      return text('profile', 'label')
    },
    get hint() {
      return text('profile', 'hint')
    },
    icon: 'user',
    go: push('Profile'),
  },
  {
    id: 'd-assistant',
    get label() {
      return text('assistant', 'label')
    },
    get hint() {
      return text('assistant', 'hint')
    },
    icon: 'message-square',
    go: push('Assistant'),
  },
  {
    id: 'd-settings',
    get label() {
      return text('settings', 'label')
    },
    get hint() {
      return text('settings', 'hint')
    },
    icon: 'settings',
    go: push('Settings'),
  },
  {
    id: 'd-transfer',
    get label() {
      return text('transfer', 'label')
    },
    get hint() {
      return text('transfer', 'hint')
    },
    icon: 'smartphone',
    go: push('Transfer'),
  },
  {
    id: 'd-guide',
    get label() {
      return text('guide', 'label')
    },
    get hint() {
      return text('guide', 'hint')
    },
    icon: 'help-circle',
    go: push('Guide'),
  },
  {
    id: 'd-more',
    get label() {
      return text('more', 'label')
    },
    get hint() {
      return text('more', 'hint')
    },
    icon: 'grid',
    go: tab('More'),
  },
]
