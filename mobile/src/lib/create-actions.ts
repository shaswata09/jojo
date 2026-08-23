import { useCallback } from 'react'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { isConfigured } from '@/lib/llm'
import { useModelSettings } from '@/lib/model-settings-context'
import { useSheets } from '@/lib/sheets-context'
import type { SheetName } from '@/lib/sheets-context'
import type { FeatherName } from '@/lib/timeline-visuals'
import type { RootStackParamList, TabParamList } from '@/navigation/types'

export type CreateAction = {
  id: string
  label: string
  icon: FeatherName
  /**
   * A second line under the label. It says where the row goes when that is not
   * obvious — a row that opens a screen rather than a sheet is a different
   * promise from the ones above it, and the hint is where that gets said.
   */
  hint?: string
  /** The sheet this row opens, with whatever it should open with. */
  sheet?: { name: SheetName; props?: Record<string, unknown> }
  /**
   * Or the screen that owns this kind of record.
   *
   * Links, files, snippets and postings are all created in place — the Vault's
   * tools and the scout's capture panel each hold a real form, and lifting one
   * into a sheet would be a second editor for the same record. So these rows
   * navigate rather than naming a sheet that does not exist.
   */
  tab?: { screen: keyof TabParamList; params?: Record<string, unknown> }
  screen?: keyof RootStackParamList
  /**
   * A capability this row needs before it is worth offering.
   *
   * `model` means a local model is configured. The row it gates hands a page to
   * one and can do nothing without it, and a row that opens a sheet whose only
   * message is "set a model up first" is a row that wasted the tap. Hidden
   * rather than disabled, for the same reason the Vault rows navigate rather
   * than naming sheets that do not exist.
   *
   * CONFIGURED, not reachable. Settings draws that difference and probes to
   * tell them apart; this does not. A row that appears a second late, because a
   * probe came back, moves the list under the thumb already reaching for it. So
   * the row shows whenever there is an address to try, and the sheet behind it
   * reports what actually happened when it tried.
   */
  requires?: 'model'
}

/**
 * Everything you can create, in one array.
 *
 * The tab bar's + menu and the search screen both offer these, and when each
 * owned its own copy the search screen kept an item the menu had renamed and
 * missed the one it had gained. Data here, rendering in the two surfaces — they
 * can disagree about layout, never about what exists.
 *
 * Ordered by how often a tracker actually needs them, not alphabetically.
 */
export const CREATE_ACTIONS: CreateAction[] = [
  {
    id: 'new-application',
    label: 'New application',
    icon: 'clipboard',
    sheet: { name: 'application' },
  },
  {
    id: 'new-application-from-link',
    label: 'Application from a link',
    icon: 'zap',
    hint: 'The model reads the posting and fills the form in',
    sheet: { name: 'applicationFromLink' },
    requires: 'model',
  },
  {
    id: 'new-reminder',
    label: 'New reminder',
    icon: 'bell',
    // Reminders and events are one record with one sheet — `mode` only picks
    // which fields lead, so the two rows cannot drift into two editors.
    sheet: { name: 'timelineItem', props: { mode: 'reminder' } },
  },
  {
    id: 'new-event',
    label: 'New event',
    icon: 'calendar',
    sheet: { name: 'timelineItem', props: { mode: 'event' } },
  },
  {
    id: 'draft-message',
    label: 'Draft a message',
    icon: 'mail',
    // Opened with no record, so nothing is substituted and every blank stays on
    // the page. Reachable from a reminder as well, where it can also tick it off.
    hint: 'From your email snippets — nothing is generated',
    sheet: { name: 'draft' },
  },
  {
    id: 'save-link',
    label: 'Save a link',
    icon: 'link-2',
    hint: 'Opens the Vault, links tool',
    tab: { screen: 'Vault', params: { tool: 'links' } },
  },
  {
    id: 'record-document',
    label: 'Record a document',
    icon: 'file-text',
    hint: 'Opens the Vault, files tool',
    tab: { screen: 'Vault', params: { tool: 'files' } },
  },
  {
    id: 'save-posting',
    label: 'Save a posting',
    icon: 'briefcase',
    hint: 'Opens Job scout',
    screen: 'JobScout',
  },
]

/**
 * The rows worth offering right now.
 *
 * Both surfaces that render `CREATE_ACTIONS` call this rather than the array,
 * so a gated row cannot appear on the search screen and be missing from the +
 * menu — which is exactly the drift the one-array note above exists to prevent.
 */
export function useCreateActions(): CreateAction[] {
  const { settings } = useModelSettings()
  const hasModel = isConfigured(settings)
  return CREATE_ACTIONS.filter((action) => action.requires !== 'model' || hasModel)
}

/**
 * Runs one of the rows above, whichever kind it is.
 *
 * Both surfaces that render `CREATE_ACTIONS` need this, and when each read the
 * shape itself one of them kept calling `open` on a row the other had turned
 * into a link. One reader, so a new kind of action lands in both places at once.
 */
export function useRunCreateAction() {
  const { open } = useSheets()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()

  return useCallback(
    (action: CreateAction) => {
      if (action.sheet) open(action.sheet.name, action.sheet.props)
      else if (action.tab) {
        navigation.navigate('Tabs', {
          screen: action.tab.screen,
          params: action.tab.params,
        } as never)
      } else if (action.screen) navigation.navigate(action.screen as never)
    },
    [open, navigation],
  )
}
