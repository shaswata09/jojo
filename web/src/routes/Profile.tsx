import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader, PageOption } from '@/components/common/PageHeader'
import { BackgroundPanel } from '@/components/profile/BackgroundPanel'
import { DocumentsPanel } from '@/components/profile/DocumentsPanel'
import { InterestsPanel } from '@/components/profile/InterestsPanel'
import { ProfileFields } from '@/components/profile/ProfileFields'
import { SaveBar } from '@/components/profile/SaveBar'
import { useProfileForm } from '@/components/profile/use-profile-form'
import { Switch } from '@/components/ui/switch'
import { useTitle } from '@/lib/links'
import { useFocusParam } from '@/lib/link-params'
import { focusFallback } from '@/lib/search-places'
import { useArrivalHighlight, useFocusArrival } from '@/lib/use-arrival-highlight'

export function Profile() {
  const { t } = useTranslation('pages')
  useTitle(t('profile.tabTitle'))
  // A search result naming one section or field — see `Settings`.
  const { focus, clearFocus, arrival } = useFocusParam()
  useArrivalHighlight(focus, clearFocus, arrival)
  useFocusArrival(focus, { fallbackOf: focusFallback, arrival })
  // Page option: the profile drives scoring, so seeing that spelled out helps
  // the first time and is noise thereafter.
  const [showScoringHelp, setShowScoringHelp] = useState(true)
  // The saved record, the edit over it, and Save / Discard — see `useProfileForm`.
  const form = useProfileForm()

  return (
    <>
      <PageHeader
        title={t('profile.title')}
        subtitle={showScoringHelp ? t('profile.subtitleLong') : t('profile.subtitleShort')}
        settings={
          <PageOption
            label={t('profile.explainOption')}
            hint={t('profile.explainHint')}
            control={
              <Switch
                checked={showScoringHelp}
                onCheckedChange={setShowScoringHelp}
                aria-label={t('profile.explainOption')}
              />
            }
          />
        }
      />

      <ProfileFields draft={form.draft} set={form.set} />

      <InterestsPanel
        profile={form.profile}
        update={form.update}
        draft={form.draft}
        set={form.set}
      />

      {/* Above Documents, because it is what the documents are FOR. Somebody
          looking at this page after an import wants to see what was taken from
          the file, not the file. */}
      <BackgroundPanel />

      <DocumentsPanel />

      <SaveBar dirty={form.dirty} onDiscard={form.discard} onSave={form.onSave} />
    </>
  )
}
