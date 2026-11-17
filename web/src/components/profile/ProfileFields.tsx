import type { ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Field } from '@/components/common/Field'
import { Panel, PanelTitle } from '@/components/common/Panel'
import type { ProfileText } from '@/data/profile'

type Setter = (key: keyof ProfileText) => (event: ChangeEvent<HTMLInputElement>) => void

/** The Basics and Links panels: the profile's text fields, side by side on a wide screen. */
export function ProfileFields({ draft, set }: { draft: ProfileText; set: Setter }) {
  const { t } = useTranslation('profile')
  return (
    <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
      <Panel>
        <PanelTitle>{t('fields.basics')}</PanelTitle>
        {/* Every field carries a placeholder, which only matters on an empty
            store: with the records cleared this page used to render a
            stranger's name and email as real values, in inputs a reader would
            reasonably take for their own answers. Grey examples ask a
            question; black text answers one. */}
        <div className="space-y-3">
          <Field
            label={t('fields.fullName.label')}
            value={draft.fullName}
            autoComplete="name"
            placeholder={t('fields.fullName.placeholder')}
            onChange={set('fullName')}
          />
          <Field
            label={t('fields.position.label')}
            autoComplete="organization-title"
            value={draft.position}
            placeholder={t('fields.position.placeholder')}
            onChange={set('position')}
          />
          <Field
            label={t('fields.location.label')}
            autoComplete="address-level2"
            value={draft.location}
            placeholder={t('fields.location.placeholder')}
            onChange={set('location')}
          />
          <Field
            label={t('fields.email.label')}
            type="email"
            value={draft.email}
            autoComplete="email"
            mono
            placeholder="you@university.edu"
            onChange={set('email')}
          />
        </div>
      </Panel>

      <Panel>
        <PanelTitle>{t('fields.links')}</PanelTitle>
        <div className="space-y-3">
          <Field
            label={t('fields.website.label')}
            autoComplete="url"
            type="url"
            value={draft.website}
            mono
            placeholder="https://your-site.dev"
            onChange={set('website')}
          />
          <Field
            label="Google Scholar"
            type="url"
            value={draft.scholar}
            mono
            placeholder="https://scholar.google.com/citations?user=…"
            onChange={set('scholar')}
          />
          <Field
            label="GitHub"
            type="url"
            value={draft.github}
            mono
            placeholder="https://github.com/you"
            onChange={set('github')}
          />
          <Field
            label="LinkedIn"
            type="url"
            value={draft.linkedin}
            mono
            placeholder="https://linkedin.com/in/you"
            onChange={set('linkedin')}
          />
        </div>
      </Panel>
    </div>
  )
}
