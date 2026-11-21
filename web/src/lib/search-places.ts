import { SECTIONS as OVERVIEW_SECTIONS } from '@/components/guide/overview/sections'
import { SECTIONS as SCREENS_SECTIONS } from '@/components/guide/screens/sections'
import {
  VAULT_TOOLS,
  guidePath,
  profilePath,
  scoutPath,
  settingsPath,
  statisticsPath,
  vaultPath,
  type VaultTool,
} from '@/lib/links'

/**
 * Every place the search palette can take you that is not a record: each
 * setting, each profile field, the Vault's tools, the scout's panels, the
 * statistics cards and the guide's sections.
 *
 * Why a registry rather than reading the page. The palette mounts on every
 * route and a Settings row only exists while Settings is open, so the palette
 * cannot find the row by looking for it — it has to be told it exists. The cost
 * of being told is that the list can drift from the page; the guard in
 * `search-places.requests.test.ts` is what stops that: it reads the Settings and
 * Profile sources and fails when a row has no `focusId`, when a `focusId` is not
 * listed here, or when an id listed here is no longer in the source.
 *
 * LABELS ARE CATALOG KEYS, `namespace:key`, and the same key the row itself
 * shows — so a place is found by the words on screen in whichever of the twenty
 * languages is showing, and renaming a setting renames its search result. They
 * are resolved where the palette draws them, never here: this module is loaded
 * once and a language switch would leave module-scope strings behind.
 *
 * KEYWORDS ARE ENGLISH, deliberately. They are extra match terms — what
 * somebody types when they do not know what jojo calls a thing ("dark mode" for
 * the theme, "token" for the API key) — and the translated label is matched as
 * well, so a reader in Japanese still finds テーマ by its own name.
 */

export type PlaceGroup = 'settings' | 'profile' | 'vault' | 'scout' | 'statistics' | 'guide'

export type Place = {
  /** The row's `focusId` for Settings and Profile; unique across the registry. */
  id: string
  group: PlaceGroup
  /** Catalog key, `namespace:key` — the label the place shows on its page. */
  label?: string
  /** Literal label, only for names that are not translated (Google Scholar, GitHub). */
  text?: string
  /** Catalog key of the row's own description, when it has a plain one. */
  detail?: string
  /**
   * The panel the row sits in: shown beside the row so "Test connection" says
   * which of the two it is, and landed on instead when the row itself is not
   * drawn (the API key field for a provider that takes none).
   */
  panel?: string
  /** Extra English match terms, never shown. */
  keywords?: string
  to: string
}

const setting = (
  id: string,
  label: string,
  keywords: string,
  more: { detail?: string; panel?: string } = {},
): Place => ({ id, group: 'settings', label, keywords, to: settingsPath({ focus: id }), ...more })

const profile = (
  id: string,
  label: string | { text: string },
  keywords: string,
  more: { detail?: string; panel?: string } = {},
): Place => ({
  id,
  group: 'profile',
  ...(typeof label === 'string' ? { label } : label),
  keywords,
  to: profilePath({ focus: id }),
  ...more,
})

/** A row inside a Settings panel. */
const row =
  (panel: string) =>
  (id: string, label: string, keywords: string, detail?: string): Place =>
    setting(id, label, keywords, { panel, ...(detail ? { detail } : {}) })

const model = row('model')
const reader = row('reader')
const mcp = row('mcp')
const capture = row('capture')
const appearance = row('appearance')
const data = row('data')
const documents = row('documents')
const keywords = row('keywords')
const crash = row('crash')
const diagnostics = row('diagnostics')

/** In page order, panel first and its rows after it. */
export const SETTINGS_PLACES: readonly Place[] = [
  setting(
    'model',
    'settings:model.title',
    'llm ai assistant provider local cloud ollama openai anthropic claude gemini connect',
    { detail: 'settings:model.hint' },
  ),
  model(
    'model-provider',
    'settings:model.provider',
    'llm provider ollama openai anthropic claude gemini groq openrouter lm studio vllm cloud local',
  ),
  model('model-saved-servers', 'settings:model.savedServers', 'saved servers list history switch'),
  model(
    'model-endpoint',
    'settings:model.endpoint.label',
    'url address server host port localhost base url',
    'settings:model.endpoint.hint',
  ),
  model(
    'model-api-key',
    'settings:model.apiKey.label',
    'token secret openai anthropic key credential password',
    'settings:model.apiKey.hint',
  ),
  model(
    'model-name',
    'settings:model.modelField.label',
    'model id name llama qwen gpt gemma',
    'settings:model.modelField.hint',
  ),
  model(
    'model-saved-as',
    'settings:model.savedAs.label',
    'name rename nickname server',
    'settings:model.savedAs.hint',
  ),
  model(
    'model-context-window',
    'settings:model.contextWindow.label',
    'context window tokens num_ctx length size compaction',
  ),
  model(
    'model-reasoning',
    'settings:model.reasoning.label',
    'thinking reasoning think effort',
    'settings:model.reasoning.description',
  ),
  model(
    'model-test',
    'settings:shared.testConnection',
    'test connection check connected ping verify model',
  ),

  setting('reader', 'settings:reader.title', 'markitdown document reader pdf docx convert parse cv', {
    detail: 'settings:shared.optional',
  }),
  reader(
    'reader-address',
    'settings:reader.address.label',
    'url endpoint address server markitdown port',
    'settings:reader.address.hint',
  ),
  reader(
    'reader-setup',
    'settings:reader.copySetup',
    'install setup command pip terminal markitdown run',
    'settings:reader.notRunning',
  ),
  reader(
    'reader-test',
    'settings:shared.testConnection',
    'test connection check connected ping verify reader markitdown',
  ),

  setting('mcp', 'settings:mcp.title', 'mcp claude code bridge jojo-bridge client connect', {
    detail: 'settings:mcp.intro',
  }),
  mcp('mcp-allow', 'settings:mcp.allow', 'enable allow mcp bridge claude code switch'),
  mcp(
    'mcp-token',
    'settings:mcp.newToken',
    'token regenerate rotate secret bridge',
    'settings:mcp.newTokenNote',
  ),

  setting('capture', 'settings:capture.title', 'browser extension chrome edge firefox capture clip', {
    detail: 'settings:capture.intro',
  }),
  capture(
    'capture-install',
    'settings:capture.download',
    'download install extension zip chrome developer mode load unpacked',
  ),

  setting('appearance', 'settings:appearance.title', 'look display ui'),
  appearance(
    'appearance-theme',
    'settings:appearance.theme.label',
    'dark mode light mode appearance colour color night system',
    'settings:appearance.theme.description',
  ),
  appearance(
    'appearance-language',
    'common:language.label',
    'language locale translation translate english',
    'common:language.description',
  ),
  appearance(
    'appearance-gestures',
    'settings:appearance.gestures.label',
    'mascot robot animation gestures wave dance',
    'settings:appearance.gestures.description',
  ),
  appearance(
    'appearance-draw',
    'settings:appearance.draw.label',
    'stroke draw mascot robot move gesture pad',
    'settings:appearance.draw.description',
  ),
  appearance(
    'appearance-sounds',
    'settings:appearance.sounds.label',
    'sound audio click mute noise volume notification notifications alert',
    'settings:appearance.sounds.description',
  ),

  setting('data', 'settings:data.title', 'backup export import restore data records', {
    detail: 'settings:data.about',
  }),
  data(
    'data-backup',
    'settings:data.export.idle',
    'backup export download json save copy restore import reminder file',
    'settings:data.about',
  ),
  data('data-records', 'settings:data.records.label', 'demo data sample seed load example'),
  data(
    'data-clear-records',
    'settings:data.clearRecords.label',
    'delete erase wipe reset clear all records start over',
  ),
  data(
    'data-move',
    'settings:data.move.label',
    'transfer move device phone laptop migrate pair',
    'settings:data.move.description',
  ),
  data(
    'data-clear-storage',
    'settings:data.clearStorage.label',
    'clear browser storage cache reset uninstall wipe site data',
    'settings:data.clearStorage.description',
  ),

  setting('documents', 'settings:documents.title', 'documents files storage cv cover letter', {
    detail: 'settings:documents.intro',
  }),
  documents(
    'documents-download',
    'settings:documents.downloadAll',
    'download all documents zip export files',
  ),

  setting('keywords', 'settings:keywords.title', 'labels tags keywords rename colour delete manage', {
    detail: 'settings:keywords.intro',
  }),
  keywords('keywords-add', 'settings:keywords.add', 'new keyword add label tag create'),

  setting('crash', 'settings:crash.title', 'crash reports errors bugs telemetry privacy', {
    detail: 'settings:crash.intro',
  }),
  crash(
    'crash-keep',
    'settings:crash.keep.label',
    'crash reports errors keep record bug',
    'settings:crash.keep.description',
  ),
  crash(
    'crash-usage',
    'settings:crash.usage.label',
    'analytics usage telemetry tracking privacy google share',
    'settings:crash.usage.description',
  ),

  setting('diagnostics', 'settings:diagnostics.title', 'diagnostics debug health status database', {
    detail: 'settings:diagnostics.storage',
  }),
  diagnostics(
    'diagnostics-durable',
    'settings:diagnostics.durable.label',
    'disk saved durable indexeddb',
  ),
  diagnostics('diagnostics-schema', 'settings:diagnostics.schema.label', 'schema version database'),
  diagnostics(
    'diagnostics-persisted',
    'settings:diagnostics.persisted.label',
    'persistent storage evict browser keep',
  ),
  diagnostics('diagnostics-space', 'settings:diagnostics.space.label', 'quota disk space usage size'),
  diagnostics('diagnostics-queue', 'settings:diagnostics.queue.label', 'write queue saving pending'),
  diagnostics(
    'diagnostics-skipped',
    'settings:diagnostics.skipped.label',
    'corrupt unreadable skipped broken records',
  ),
  diagnostics(
    'diagnostics-integrity',
    'settings:diagnostics.integrity.label',
    'integrity check problems consistency',
  ),

  setting('audit', 'settings:audit.title', 'audit log history undo changes activity', {
    detail: 'settings:audit.footer',
  }),
]

/**
 * Prefixes of `focusId`s minted per record rather than written out — one per
 * keyword. The palette lists those from the store; the guard accepts a
 * template-literal `focusId` only with one of these in front.
 */
export const DYNAMIC_FOCUS_PREFIXES = ['keyword:'] as const

const basics = (id: string, label: string | { text: string }, keywords: string) =>
  profile(id, label, keywords, { panel: 'profile-basics' })
const links = (id: string, label: string | { text: string }, keywords: string) =>
  profile(id, label, keywords, { panel: 'profile-links' })
const interests = (id: string, label: string, keywords: string, detail?: string) =>
  profile(id, label, keywords, { panel: 'profile-interests', ...(detail ? { detail } : {}) })

export const PROFILE_PLACES: readonly Place[] = [
  profile('profile-basics', 'profile:fields.basics', 'about me name contact personal details'),
  basics('profile-full-name', 'profile:fields.fullName.label', 'name full name'),
  basics('profile-position', 'profile:fields.position.label', 'position title job current role'),
  basics('profile-location', 'profile:fields.location.label', 'location city country where'),
  basics('profile-email', 'profile:fields.email.label', 'email mail address contact'),
  profile('profile-links', 'profile:fields.links', 'links urls online profiles'),
  links('profile-website', 'profile:fields.website.label', 'website homepage url site'),
  links('profile-scholar', { text: 'Google Scholar' }, 'scholar citations publications'),
  links('profile-github', { text: 'GitHub' }, 'github code repositories'),
  links('profile-linkedin', { text: 'LinkedIn' }, 'linkedin network'),
  profile('profile-interests', 'profile:interests.title', 'interests targets scout matching', {
    detail: 'profile:interests.hint',
  }),
  interests(
    'profile-match-terms',
    'profile:interests.matchTerms.title',
    'match terms research areas scout keywords',
    'profile:interests.matchTerms.description',
  ),
  interests(
    'profile-role-tags',
    'profile:roleTags.title',
    'role tags kinds of role categories filter',
    'profile:roleTags.description',
  ),
  interests('profile-target-roles', 'profile:interests.targetRoles.label', 'target roles jobs'),
  interests('profile-regions', 'profile:interests.regions.label', 'regions countries where location'),
  interests('profile-academia', 'profile:interests.academia', 'academia academic university postings'),
  interests('profile-industry', 'profile:interests.industry', 'industry company postings'),
  profile('profile-background', 'profile:background.title', 'background cv resume experience education facts'),
  profile(
    'profile-background-add',
    'profile:background.addEntry',
    'add entry education job publication award read cv document',
    { panel: 'profile-background' },
  ),
  profile('profile-documents', 'profile:documents.title', 'documents cv resume cover letter files'),
  profile(
    'profile-documents-upload',
    'profile:documents.upload',
    'upload cv resume document file add',
    { panel: 'profile-documents' },
  ),
]

/** The Vault's tabs, each by the label on its own pill. */
const VAULT_TAB_KEYWORDS: Record<VaultTool, string> = {
  reminders: 'reminders follow up due todo tasks',
  links: 'links bookmarks urls saved pages',
  files: 'files documents uploads pdf cv',
  snippets: 'snippets text paragraphs templates answers',
  people: 'people contacts referees recommenders',
  tools: 'tools instruments',
}

export const VAULT_PLACES: readonly Place[] = [
  ...VAULT_TOOLS.map(
    (tool): Place => ({
      id: `vault-${tool}`,
      group: 'vault',
      label: `pages:vault.tools.${tool}`,
      keywords: `vault ${VAULT_TAB_KEYWORDS[tool]}`,
      to: vaultPath({ tool }),
    }),
  ),
  {
    id: 'vault-calculator',
    group: 'vault',
    label: 'vault:instruments.calculator',
    keywords: 'calculator maths sum add numbers salary',
    to: vaultPath({ tool: 'tools', focus: 'calculator' }),
  },
  {
    id: 'vault-pdf',
    group: 'vault',
    label: 'vault:instruments.pdf',
    keywords: 'pdf editor annotate sign highlight merge pages',
    to: vaultPath({ tool: 'tools', focus: 'pdf' }),
  },
]

/** The scout's four panels; each carries `data-focus-id="section:<id>"`. */
export const SCOUT_SECTIONS = ['pipelines', 'proposals', 'matches', 'postings'] as const

const SCOUT_KEYWORDS: Record<(typeof SCOUT_SECTIONS)[number], string> = {
  pipelines: 'pipelines boards scan search schedule automatic',
  proposals: 'suggestions proposals approve discard queue',
  matches: 'matches fit scored jobs',
  postings: 'save posting url link job ad',
}

export const SCOUT_PLACES: readonly Place[] = SCOUT_SECTIONS.map((section) => ({
  id: `scout-${section}`,
  group: 'scout',
  label: `scout:${section}.title`,
  detail: `scout:${section}.hint`,
  keywords: `job scout ${SCOUT_KEYWORDS[section]}`,
  to: scoutPath({ focus: { kind: 'section', id: section } }),
}))

/**
 * The statistics cards, each a `focusId` on its panel. Two of them render only
 * once there is something to say, and land on nothing before then — the page
 * still opens, which is the honest answer to "where is it".
 */
export const STATISTICS_PLACES: readonly Place[] = (
  [
    ['stats-next-steps', 'statistics:nextSteps.title', 'what to do next advice recommendations'],
    ['stats-headline', 'pages:statistics.headlineRates', 'headline rates response interview offer rate'],
    ['stats-what-is-working', 'statistics:whatIsWorking.title', 'what is working comparison'],
    ['stats-frequency', 'dashboard:frequency.title', 'when applied frequency per week chart'],
    ['stats-sources', 'dashboard:sources.title', 'sources where they came from channels'],
    ['stats-funnel', 'pages:statistics.funnelTitle', 'funnel stages how far'],
    ['stats-outcomes', 'pages:statistics.outcomes', 'outcomes results rejected offers'],
    ['stats-search-health', 'dashboard:searchHealth.title', 'search health what to work on'],
    ['stats-roles', 'pages:statistics.rolesTitle', 'roles per role table breakdown'],
  ] as const
).map(([id, label, keywords]) => ({
  id,
  group: 'statistics',
  label,
  keywords: `statistics stats charts ${keywords}`,
  to: statisticsPath({ focus: id }),
}))

/**
 * The guide's sections, by the labels on the page's own "On this page" pills
 * and the lists those pills are built from — so a section added there is
 * searchable without touching this file.
 */
export const GUIDE_PLACES: readonly Place[] = [
  ...OVERVIEW_SECTIONS.map(
    ({ id }): Place => ({
      id: `guide-overview-${id}`,
      group: 'guide',
      label: `guide:overview.sections.${id}`,
      keywords: 'guide help how to',
      to: guidePath('overview', id),
    }),
  ),
  ...SCREENS_SECTIONS.map(
    ({ id }): Place => ({
      id: `guide-screens-${id}`,
      group: 'guide',
      label: `guide:screens.sections.${id}`,
      keywords: 'guide help screens reference what does this page do',
      to: guidePath('screens', id),
    }),
  ),
]

export const SEARCH_PLACES: readonly Place[] = [
  ...SETTINGS_PLACES,
  ...PROFILE_PLACES,
  ...VAULT_PLACES,
  ...SCOUT_PLACES,
  ...STATISTICS_PLACES,
  ...GUIDE_PLACES,
]

const byId = new Map(SEARCH_PLACES.map((place) => [place.id, place]))

export function placeById(id: string): Place | undefined {
  return byId.get(id)
}

/**
 * Where a `?focus=` lands when its own row is not drawn: the panel the row
 * belongs to. A module function, so `useFocusArrival` can hold it as a stable
 * dependency.
 */
export function focusFallback(id: string): string | undefined {
  if (id.startsWith('keyword:')) return 'keywords'
  return byId.get(id)?.panel
}
