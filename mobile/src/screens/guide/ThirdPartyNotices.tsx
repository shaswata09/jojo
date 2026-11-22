import { useMemo, useState } from 'react'
import { Platform, Pressable, SectionList, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Icon } from '@/components/ui/Icon'
import { SearchInput } from '@/components/ui/SearchInput'
import { Sheet } from '@/components/ui/Sheet'
import { Divider, Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'
import {
  filterNotices,
  licenceTally,
  loadNotices,
  noticeBody,
} from '@/screens/guide/third-party-notices'
import type { Notices, PackageNotice } from '@/screens/guide/third-party-notices'

/**
 * The licences of everything the phone app is built from, on the phone.
 *
 * ## Why it is here and not only on the web
 *
 * The APK is a redistribution of some seven hundred packages, and MIT, ISC,
 * BSD and Apache-2.0 all ask for their notice to go with the code. A minified
 * bundle keeps none of them, and a list on the web app's Guide is not "with"
 * an APK somebody side-loaded — so the notices are in the app, generated from
 * the installed packages (`mobile/scripts/third-party-notices.mjs`). The same
 * goes for the native libraries the two apps link — the Maven artefacts in the
 * APK, the pods in the iOS app — which come from a committed inventory the
 * same script writes from Gradle and CocoaPods, one section per platform.
 *
 * ## Why a sheet with a list
 *
 * Seven hundred rows inside the Guide's scroll view would be a page nobody
 * reaches the end of, and a list in a scroll view in the same direction does
 * not scroll on Android. So the Built with page carries one panel — how many,
 * under which licences — and the full list opens in a tall sheet with its own
 * virtualised list and a filter. A row expands in place to the package's own
 * licence file, its NOTICE if it has one, the third-party code bundled inside
 * it, and the shared licence text it points at. The legal texts are shown as
 * written, in English; translating a licence would be publishing a different
 * licence. The section headings are the app's own words and are translated.
 */
export function ThirdPartyNotices() {
  const { t } = useTranslation('guide')
  const [open, setOpen] = useState(false)
  // Parsed once the panel draws, not at launch — see `loadNotices`.
  const notices = useMemo(() => loadNotices(), [])
  const everything = useMemo(
    () => [...notices.native.android, ...notices.native.ios, ...notices.packages],
    [notices],
  )
  const tally = useMemo(() => licenceTally(everything), [everything])

  return (
    <Panel>
      <PanelTitle hint={t('builtWith.licences.hint', { count: everything.length })}>
        {t('builtWith.licences.title')}
      </PanelTitle>
      <Txt size="sm" tone="secondary" style={{ marginBottom: space[2] }}>
        {t('builtWith.licences.intro')}
      </Txt>
      <Txt size="xs" tone="muted" mono style={{ marginBottom: space[3] }}>
        {tally.map(([licence, count]) => `${licence} ${String(count)}`).join(' · ')}
      </Txt>
      <Button
        label={t('builtWith.licences.open')}
        icon="file-text"
        variant="outline"
        full
        onPress={() => setOpen(true)}
      />
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t('builtWith.licences.sheetTitle')}
        description={t('builtWith.licences.sheetDescription')}
        size="tall"
        scroll={false}
      >
        {open ? <NoticeList /> : null}
      </Sheet>
    </Panel>
  )
}

type SectionKey = 'android' | 'ios' | 'npm'

/**
 * The three lists in reading order: the platform the reader is holding first,
 * then the other platform's, then the npm packages both apps share. A section
 * the filter empties is dropped, heading and all.
 */
function sectionsFor(notices: Notices, query: string) {
  const native: SectionKey[] = Platform.OS === 'ios' ? ['ios', 'android'] : ['android', 'ios']
  const rows: Record<SectionKey, readonly PackageNotice[]> = {
    android: notices.native.android,
    ios: notices.native.ios,
    npm: notices.packages,
  }
  return [...native, 'npm' as const]
    .map((key) => ({ key, data: filterNotices(rows[key], query) }))
    .filter((section) => section.data.length > 0)
}

/** The filter and the list. Mounted only while the sheet is open. */
function NoticeList() {
  const { t } = useTranslation('guide')
  const notices = loadNotices()
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const sections = useMemo(() => sectionsFor(notices, query), [notices, query])

  return (
    <View style={{ flex: 1, gap: space[3] }}>
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder={t('builtWith.licences.search')}
        label={t('builtWith.licences.searchLabel')}
      />
      <SectionList
        sections={sections}
        keyExtractor={(p, index) => `${p.name}@${p.version}#${String(index)}`}
        stickySectionHeadersEnabled={false}
        ItemSeparatorComponent={Divider}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={20}
        // The things that ship and are not packages come first: the fonts'
        // licence and the native SDKs' terms are what a filter for a package
        // name would never find.
        ListHeaderComponent={
          query.trim() === '' ? (
            <View style={{ paddingBottom: space[3], gap: space[3] }}>
              {notices.extra.map((section) => (
                <View key={section.heading}>
                  <Txt size="sm" weight="medium">
                    {section.heading}
                  </Txt>
                  <Txt size="xs" tone="muted" mono selectable style={{ marginTop: space[1] }}>
                    {section.text}
                  </Txt>
                </View>
              ))}
              <Divider />
            </View>
          ) : null
        }
        ListEmptyComponent={
          <Txt size="sm" tone="muted" style={{ paddingVertical: space[3] }}>
            {t('builtWith.licences.empty')}
          </Txt>
        }
        renderSectionHeader={({ section }) => (
          <View
            accessibilityRole="header"
            style={[s.row, { paddingTop: space[3], paddingBottom: space[1.5] }]}
          >
            <Txt size="sm" weight="semibold" style={s.fill}>
              {t(`builtWith.licences.sections.${section.key}`)}
            </Txt>
            <Txt size="xs" tone="muted" mono>
              {String(section.data.length)}
            </Txt>
          </View>
        )}
        renderItem={({ item, section }) => {
          const key = `${section.key}:${item.name}@${item.version}`
          return (
            <NoticeRow
              notice={item}
              open={expanded === key}
              onToggle={() => setExpanded((was) => (was === key ? null : key))}
              body={expanded === key ? noticeBody(item, notices.shared, notices.native) : ''}
            />
          )
        }}
      />
    </View>
  )
}

function NoticeRow({
  notice,
  open,
  onToggle,
  body,
}: {
  notice: PackageNotice
  open: boolean
  onToggle: () => void
  body: string
}) {
  const { t } = useTranslation('guide')
  const c = useColors()
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={t('builtWith.licences.rowLabel', {
          name: notice.name,
          version: notice.version,
          licence: notice.licence ?? t('builtWith.licences.noLicence'),
        })}
        onPress={onToggle}
        style={({ pressed }) => [
          s.row,
          {
            paddingVertical: space[2.5],
            backgroundColor: pressed ? c.rowHover : 'transparent',
          },
        ]}
      >
        <View style={s.fill}>
          <Txt size="sm" weight="medium" mono numberOfLines={1}>
            {notice.name}
          </Txt>
          <Txt size="xs" tone="muted" mono>
            {notice.version}
          </Txt>
        </View>
        {notice.licence ? (
          <Chip size="sm">{notice.licence}</Chip>
        ) : (
          <Chip size="sm" tone="amber">
            {t('builtWith.licences.noLicence')}
          </Chip>
        )}
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} color={c.text3} />
      </Pressable>
      {open ? (
        <Txt size="xs" tone="muted" mono selectable style={{ paddingBottom: space[3] }}>
          {body}
        </Txt>
      ) : null}
    </View>
  )
}
