import { useState } from 'react'
import { PageHeader, PageOption } from '@/components/common/PageHeader'
import { BackgroundPanel } from '@/components/profile/BackgroundPanel'
import { DocumentsPanel } from '@/components/profile/DocumentsPanel'
import { InterestsPanel } from '@/components/profile/InterestsPanel'
import { ProfileFields } from '@/components/profile/ProfileFields'
import { SaveBar } from '@/components/profile/SaveBar'
import { useProfileForm } from '@/components/profile/use-profile-form'
import { Switch } from '@/components/ui/switch'
import { useTitle } from '@/lib/links'

export function Profile() {
  useTitle('Profile')
  // Page option: the profile drives scoring, so seeing that spelled out helps
  // the first time and is noise thereafter.
  const [showScoringHelp, setShowScoringHelp] = useState(true)
  // The saved record, the edit over it, and Save / Discard — see `useProfileForm`.
  const form = useProfileForm()

  return (
    <>
      <PageHeader
        title="My profile"
        subtitle={
          showScoringHelp
            ? 'What the scout and assistant use to match and draft. None of it leaves your device.'
            : 'Basics, documents and match terms'
        }
        settings={
          <PageOption
            label="Explain what this feeds"
            hint="The longer subtitle about scoring and privacy"
            control={
              <Switch
                checked={showScoringHelp}
                onCheckedChange={setShowScoringHelp}
                aria-label="Explain what this feeds"
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
