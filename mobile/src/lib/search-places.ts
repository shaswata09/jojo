import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import type { FeatherName } from '@/lib/timeline-visuals'
import { GUIDE_PAGES } from '@/navigation/types'
import type { GuidePage, RootStackParamList, VaultTool } from '@/navigation/types'
import { toTab } from '@/navigation/to-tab'

/** The navigator every screen in the app is pushed onto. */
type Nav = NativeStackNavigationProp<RootStackParamList>

/**
 * Every setting, option and in-screen place, as a list search can read.
 *
 * `destinations.ts` makes the screens searchable; this makes what is ON them
 * searchable — "dark mode", "API key", "crash reports", "match terms" — which
 * is most of what anybody types into a search box when they cannot find a
 * switch. A result lands on the row itself: Settings and Profile take a
 * `focus` param, scroll the row marked with that `FocusTarget` id into view
 * and light it.
 *
 * LABELS ARE CATALOG KEYS, `namespace:key`, and the SAME key the screen draws
 * — never a copy of its English, and never resolved here. The search screen
 * translates them when it draws the row, so a result reads what the screen
 * reads in whichever of the twenty languages is on. `name` is for the three
 * profile fields the screen labels with a brand (GitHub), which no catalog
 * translates.
 *
 * KEYWORDS ARE ENGLISH SYNONYMS and only that — the words somebody types who
 * does not know what jojo calls the thing ("dark mode" for Theme, "token" for
 * API key). They are matched, never shown.
 *
 * `mobile/src/lib/search-places.requests.test.ts` holds this list to the
 * screens: every focus id drawn on Settings or Profile is listed here, every
 * id listed here is drawn, and every label key is in the English catalog.
 */

export type PlaceGroup = 'settings' | 'places'

/** Where a result goes. Each kind is one route and the params it takes. */
export type PlaceTarget =
  | { screen: 'Settings' | 'Profile'; focus: string }
  | { screen: 'JobScout'; section?: string; options?: true }
  | { screen: 'Statistics'; options: true }
  | { screen: 'Guide'; page: GuidePage }
  | { screen: 'Applications' | 'Calendar'; options: true }
  | { screen: 'Vault'; tool?: VaultTool; options?: true }

export type SearchPlace = {
  /** Unique. For a row with its own `FocusTarget`, the focus id itself. */
  id: string
  group: PlaceGroup
  icon: FeatherName
  /** `namespace:key` — the key the screen draws the row's label with. */
  label?: string
  /** A proper noun the screen draws untranslated, in place of `label`. */
  name?: string
  /** `namespace:key` of a short description, matched and not shown. */
  detail?: string
  /** English synonyms, matched and never shown. */
  keywords: string
  to: PlaceTarget
}

/** Each target screen's title, the first half of a result's "where" line. */
export const SCREEN_TITLE: Record<PlaceTarget['screen'], string> = {
  Settings: 'screens:settings.title',
  Profile: 'screens:profile.title',
  JobScout: 'screens:jobScout.title',
  Statistics: 'screens:statistics.title',
  Guide: 'guide:screen.title',
  Applications: 'screens:applications.title',
  Calendar: 'screens:calendar.title',
  Vault: 'vault:screen.title',
}

type Extra = Partial<Pick<SearchPlace, 'detail' | 'name' | 'icon'>> & { focus?: string }

/** A row on Settings; `focus` defaults to the id. */
const setting = (id: string, label: string, keywords: string, extra: Extra = {}): SearchPlace => {
  const { focus = id, icon = 'settings', ...rest } = extra
  return {
    id,
    group: 'settings',
    icon,
    label,
    keywords,
    ...rest,
    to: { screen: 'Settings', focus },
  }
}

/** A row on Profile; `focus` defaults to the id. */
const profile = (
  id: string,
  label: string | undefined,
  keywords: string,
  extra: Extra = {},
): SearchPlace => {
  const { focus = id, icon = 'user', ...rest } = extra
  return { id, group: 'settings', icon, label, keywords, ...rest, to: { screen: 'Profile', focus } }
}

/** A switch behind a page's ⋯ options sheet. */
const pageOption = (
  id: string,
  label: string,
  detail: string,
  keywords: string,
  to: PlaceTarget,
): SearchPlace => ({ id, group: 'settings', icon: 'sliders', label, detail, keywords, to })

export const SEARCH_PLACES: readonly SearchPlace[] = [
  /* -------------------------------- Settings -------------------------------- */
  setting(
    'settings.device',
    'screens:settings.device.title',
    'storage local offline phone where data saved on device',
    {
      icon: 'smartphone',
    },
  ),

  setting(
    'settings.model',
    'screens:settings.model.title',
    'ai llm assistant language model connection server local cloud',
    {
      icon: 'cpu',
    },
  ),
  setting(
    'settings.model.servers',
    'screens:settings.servers.title',
    'saved servers previous addresses switch server load forget',
    { focus: 'settings.model', icon: 'link' },
  ),
  setting(
    'settings.model.provider',
    'screens:settings.provider.title',
    'openai anthropic claude nvidia ollama vllm lm studio llama.cpp gemini cloud local provider vendor',
    { icon: 'cpu' },
  ),
  setting(
    'settings.model.endpoint',
    'screens:settings.model.endpoint',
    'url address host port base url server ip',
    {
      icon: 'cpu',
    },
  ),
  setting(
    'settings.model.apiKey',
    'screens:settings.model.apiKey',
    'token secret openai anthropic key password credentials',
    { icon: 'key' },
  ),
  setting('settings.model.id', 'screens:settings.model.title', 'model id model name which model', {
    detail: 'screens:settings.model.modelHint',
    icon: 'cpu',
  }),
  setting(
    'settings.model.savedAs',
    'screens:settings.model.savedAs',
    'name nickname rename server label',
    {
      icon: 'cpu',
    },
  ),
  setting(
    'settings.model.context',
    'screens:settings.model.context',
    'tokens num_ctx context length window size memory',
    {
      icon: 'cpu',
    },
  ),
  setting(
    'settings.model.reasoning',
    'screens:settings.model.reasoning',
    'thinking think reason effort chain of thought',
    {
      icon: 'cpu',
    },
  ),
  setting(
    'settings.model.test',
    'screens:settings.test.test',
    'test connect check ping connection status',
    {
      icon: 'activity',
    },
  ),

  setting(
    'settings.reader',
    'screens:settings.reader.title',
    'pdf markitdown documents reader convert read files',
    {
      icon: 'file-text',
    },
  ),
  setting(
    'settings.reader.address',
    'screens:settings.reader.address',
    'markitdown mcp url endpoint reader address',
    {
      icon: 'file-text',
    },
  ),

  setting('settings.appearance', 'screens:settings.appearance.title', 'look display appearance', {
    icon: 'eye',
  }),
  setting(
    'settings.appearance.theme',
    'screens:settings.appearance.theme',
    'dark mode light mode night mode appearance colour color scheme system theme',
    { detail: 'screens:settings.appearance.themeDescription', icon: 'moon' },
  ),
  setting(
    'settings.appearance.language',
    'common:language.label',
    'language locale translation translate english bengali hindi spanish french german chinese japanese arabic',
    { icon: 'globe' },
  ),

  setting('settings.data', 'screens:settings.data.title', 'data backup records storage', {
    icon: 'database',
  }),
  setting(
    'settings.data.export',
    'screens:settings.data.export',
    'export backup download save copy json clipboard',
    {
      focus: 'settings.data.backup',
      icon: 'upload',
    },
  ),
  setting(
    'settings.data.import',
    'screens:settings.data.import',
    'import restore backup file load open',
    {
      focus: 'settings.data.backup',
      icon: 'download',
    },
  ),
  setting('settings.data.paste', 'screens:settings.data.paste', 'paste restore clipboard backup', {
    focus: 'settings.data.backup',
    icon: 'clipboard',
  }),
  setting(
    'settings.data.records',
    'screens:settings.data.records',
    'demo data sample seed empty clear wipe erase delete everything start fresh',
    { icon: 'database' },
  ),
  setting(
    'settings.data.move',
    'screens:settings.data.move',
    'transfer move pair computer laptop qr code sync migrate new phone',
    { detail: 'screens:settings.data.moveDescription', icon: 'smartphone' },
  ),
  setting(
    'settings.data.reset',
    'screens:settings.data.reset',
    'reset restore demo defaults factory',
    {
      detail: 'screens:settings.data.resetDescription',
      icon: 'rotate-ccw',
    },
  ),

  setting(
    'settings.keywords',
    'screens:settings.keywords.title',
    'keywords tags labels categories colour color rename',
    {
      icon: 'tag',
    },
  ),

  setting(
    'settings.privacy',
    'components:crash.title',
    'privacy crash reports diagnostics telemetry',
    {
      icon: 'shield',
    },
  ),
  setting(
    'settings.privacy.crash',
    'components:crash.report',
    'crash reports crashlytics bug errors diagnostics',
    {
      icon: 'shield',
    },
  ),
  setting(
    'settings.privacy.usage',
    'components:crash.usage',
    'analytics usage statistics telemetry tracking privacy',
    { icon: 'shield' },
  ),

  setting(
    'settings.audit',
    'components:audit.title',
    'history undo log changes journal activity audit',
    {
      icon: 'clock',
    },
  ),

  /* --------------------------------- Profile -------------------------------- */
  profile('profile.basics', 'screens:profile.basics.title', 'personal details about me'),
  profile('profile.basics.fullName', 'screens:profile.basics.fullName', 'name full name'),
  profile(
    'profile.basics.position',
    'screens:profile.basics.position',
    'job title current role position',
  ),
  profile(
    'profile.basics.location',
    'screens:profile.basics.location',
    'city country where i live location',
  ),
  profile('profile.basics.email', 'screens:profile.basics.email', 'email mail address contact', {
    icon: 'mail',
  }),

  profile('profile.links', 'screens:profile.links.title', 'links urls social profiles', {
    icon: 'link-2',
  }),
  profile(
    'profile.links.website',
    'screens:profile.links.website',
    'website homepage personal site url',
    {
      icon: 'link-2',
    },
  ),
  profile('profile.links.scholar', undefined, 'google scholar publications citations papers', {
    name: 'Google Scholar',
    icon: 'link-2',
  }),
  profile('profile.links.github', undefined, 'github code repositories', {
    name: 'GitHub',
    icon: 'link-2',
  }),
  profile('profile.links.linkedin', undefined, 'linkedin professional network', {
    name: 'LinkedIn',
    icon: 'link-2',
  }),

  profile(
    'profile.interests',
    'screens:profile.interests.title',
    'interests targets scout matching preferences',
    {
      icon: 'target',
    },
  ),
  profile(
    'profile.interests.matchTerms',
    'screens:profile.interests.matchTerms',
    'match terms research areas keywords phrases topics scout',
    { icon: 'target' },
  ),
  profile(
    'profile.interests.roleTags',
    'screens:profile.interests.roleTags',
    'role tags roles kinds of role categories types',
    { icon: 'target' },
  ),
  profile(
    'profile.interests.targetRoles',
    'screens:profile.interests.targetRoles',
    'target roles desired jobs positions wanted',
    { icon: 'target' },
  ),
  profile(
    'profile.interests.regions',
    'screens:profile.interests.regions',
    'regions locations places remote relocate',
    {
      icon: 'target',
    },
  ),
  profile(
    'profile.interests.academia',
    'screens:profile.interests.academia',
    'academia academic university faculty postings',
    { icon: 'target' },
  ),
  profile(
    'profile.interests.industry',
    'screens:profile.interests.industry',
    'industry company corporate postings',
    { icon: 'target' },
  ),

  profile(
    'profile.background',
    'components:background.panelTitle',
    'background cv resume experience education skills',
    {
      icon: 'award',
    },
  ),
  profile(
    'profile.documents',
    'screens:profile.documents.title',
    'documents cv resume statements cover letter files',
    {
      icon: 'file-text',
    },
  ),

  /* ------------------------- Switches behind ⋯ options ----------------------- */
  pageOption(
    'options.applications.showNotes',
    'screens:applications.showNotes',
    'screens:applications.showNotesDescription',
    'show notes second line list',
    { screen: 'Applications', options: true },
  ),
  pageOption(
    'options.calendar.tallCells',
    'screens:calendar.tallCells',
    'screens:calendar.tallCellsDescription',
    'tall day cells bigger calendar grid size',
    { screen: 'Calendar', options: true },
  ),
  pageOption(
    'options.vault.showCounts',
    'vault:screen.showCounts',
    'vault:screen.showCountsDescription',
    'show counts totals numbers',
    { screen: 'Vault', options: true },
  ),
  pageOption(
    'options.statistics.compare',
    'screens:statistics.compare',
    'screens:statistics.compareDescription',
    'compare typical search benchmark sample',
    { screen: 'Statistics', options: true },
  ),
  pageOption(
    'options.scout.onlyActive',
    'screens:jobScout.onlyActive',
    'screens:jobScout.onlyActiveDescription',
    'only active pipelines hide disabled off',
    { screen: 'JobScout', options: true },
  ),

  /* --------------------------------- Places --------------------------------- */
  {
    id: 'scout.pipelines',
    group: 'places',
    icon: 'radio',
    label: 'screens:jobScout.pipelines.title',
    keywords: 'pipelines scouts automations job feeds watchers',
    to: { screen: 'JobScout', section: 'scout.pipelines' },
  },
  {
    id: 'scout.matches',
    group: 'places',
    icon: 'radio',
    label: 'screens:jobScout.matches.title',
    keywords: 'matches suggestions fit scores postings found',
    to: { screen: 'JobScout', section: 'scout.matches' },
  },
  {
    id: 'scout.save',
    group: 'places',
    icon: 'radio',
    label: 'screens:jobScout.save.title',
    keywords: 'save posting url add job link',
    to: { screen: 'JobScout', section: 'scout.save' },
  },
  {
    id: 'vault.people',
    group: 'places',
    icon: 'users',
    label: 'vault:screen.tools.people',
    keywords: 'people contacts referees recommenders network',
    to: { screen: 'Vault', tool: 'people' },
  },
  ...GUIDE_PAGES.map((page): SearchPlace => ({
    id: `guide.${page}`,
    group: 'places',
    icon: 'help-circle',
    label: `guide:screen.pages.${page}.label`,
    detail: `guide:screen.pages.${page}.subtitle`,
    keywords: `guide help how to tutorial ${page}`,
    to: { screen: 'Guide', page },
  })),
]

/**
 * The entry a place sits inside, for its "where" line: `settings.model.apiKey`
 * is shown under Model. The nearest listed ancestor of its id, if any.
 */
export function parentOf(place: SearchPlace): SearchPlace | undefined {
  let at = place.id
  for (;;) {
    const cut = at.lastIndexOf('.')
    if (cut < 0) return undefined
    at = at.slice(0, cut)
    const hit = SEARCH_PLACES.find((p) => p.id === at)
    if (hit) return hit
  }
}

/** Every focus id the registry sends a screen to — what the screens must draw. */
export function focusIdsOf(place: SearchPlace): string[] {
  const to = place.to
  if (to.screen === 'Settings' || to.screen === 'Profile') return [to.focus]
  if (to.screen === 'JobScout' && to.section) return [to.section]
  return []
}

/** Goes to a place: the screen, with the one-shot params that land on it. */
export function goToPlace(nav: Nav, to: PlaceTarget): void {
  switch (to.screen) {
    case 'Settings':
      nav.navigate('Settings', { focus: to.focus })
      return
    case 'Profile':
      nav.navigate('Profile', { focus: to.focus })
      return
    case 'JobScout':
      nav.navigate('JobScout', { section: to.section, options: to.options })
      return
    case 'Statistics':
      nav.navigate('Statistics', { options: true })
      return
    case 'Guide':
      nav.navigate('Guide', { page: to.page })
      return
    case 'Applications':
      toTab(nav, 'Applications', { options: true })
      return
    case 'Calendar':
      toTab(nav, 'Calendar', { options: true })
      return
    case 'Vault':
      toTab(nav, 'Vault', { tool: to.tool, options: to.options })
      return
  }
}
