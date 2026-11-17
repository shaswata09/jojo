import { ShieldAlert } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Kbd } from '@/components/guide/Kbd'
import { Go } from '@/components/guide/overview/Go'
import { SavePath } from '@/components/guide/overview/SavePath'
import { settingsPath, transferPath } from '@/lib/links'

/**
 * The strips that can appear above the page, and what each one means.
 *
 * These are the one part of jojo a reader cannot be shown by following a link:
 * you cannot fill someone's disk or corrupt their database to demonstrate the
 * recovery screen. So they are written out, in the words the banner itself uses,
 * with the answer beside each — which is the whole reason this section exists.
 * Copy verified line by line against `layout/StorageBanner.tsx`.
 *
 * Each id names `overview.data.banners.<id>` in the `guide` catalog, where the
 * quoted words and the answer are.
 */
const BANNERS = ['cannotOpen', 'blocked', 'updated', 'full', 'unsaved', 'unreadable'] as const

/** The settings controls, in panel order; each is `overview.data.controls.<id>`. */
const CONTROLS = ['export', 'demo', 'clear', 'clearStorage'] as const

/** The backup's file name shape. A name, not words: the same in every language. */
const BACKUP_FILE = 'jojo-backup-YYYY-MM-DD.json'

const STRONG = <span className="text-text-1" />
const KBD = <Kbd>{''}</Kbd>

export function DataSection() {
  const { t } = useTranslation('guide')
  return (
    <Panel id="data" className="scroll-mt-4">
      <PanelTitle hint={t('overview.data.hint')}>{t('overview.data.title')}</PanelTitle>

      <h3 className="text-sm font-medium">{t('overview.data.askedTitle')}</h3>
      <p className="mt-1 text-sm text-text-2">
        <Trans
          t={t}
          i18nKey="overview.data.asked"
          components={{ settings: <Go to={settingsPath()} /> }}
        />
      </p>

      <h3 className="mt-4 text-sm font-medium">{t('overview.data.diskTitle')}</h3>
      <div className="mt-2 grid grid-cols-1 gap-4 lg:grid-cols-[auto_1fr] lg:gap-6">
        <SavePath />
        <p className="min-w-0 text-sm text-text-2">{t('overview.data.disk')}</p>
      </div>

      <h3 className="mt-4 text-sm font-medium">{t('overview.data.stripsTitle')}</h3>
      <p className="mt-1 text-sm text-text-2">{t('overview.data.strips')}</p>
      <dl className="mt-2 divide-y divide-hairline text-sm">
        {BANNERS.map((banner) => (
          <div key={banner} className="flex flex-wrap gap-x-3 gap-y-1 py-2.5">
            <dt className="basis-56 font-medium">
              {t('overview.data.quoted', { text: t(`overview.data.banners.${banner}.says`) })}
            </dt>
            <dd className="min-w-0 flex-1 basis-64 text-text-2">
              {t(`overview.data.banners.${banner}.means`)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-sm text-text-2">
        <Trans t={t} i18nKey="overview.data.recovery" components={{ strong: STRONG }} />
      </p>

      <h3 className="mt-4 text-sm font-medium">{t('overview.data.controlsTitle')}</h3>
      <dl className="mt-2 divide-y divide-hairline text-sm">
        {CONTROLS.map((control) => (
          <div key={control} className="flex flex-wrap gap-x-3 gap-y-1 py-2.5 last:pb-0">
            <dt className="basis-44 font-medium">{t(`overview.data.controls.${control}.name`)}</dt>
            <dd className="min-w-0 flex-1 basis-64 text-text-2">
              <Trans
                t={t}
                i18nKey={`overview.data.controls.${control}.body`}
                values={{ file: BACKUP_FILE }}
                components={{ strong: STRONG }}
              />
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-sm text-text-2">
        <Trans t={t} i18nKey="overview.data.lastThree" components={{ kbd: KBD, strong: STRONG }} />
      </p>

      <h3 className="mt-4 text-sm font-medium">{t('overview.data.moveTitle')}</h3>
      <p className="mt-1 text-sm text-text-2">
        <Trans
          t={t}
          i18nKey="overview.data.move"
          components={{ transfer: <Go to={transferPath()} />, strong: STRONG }}
        />
      </p>
    </Panel>
  )
}

export function BrowserIsTheDatabase() {
  const { t } = useTranslation('guide')
  return (
    <Panel className="border-warning-border">
      <div className="flex gap-3">
        <ShieldAlert
          className="mt-0.5 size-5 shrink-0 text-warning"
          strokeWidth={1.7}
          aria-hidden
        />
        <div>
          <h2 className="text-base font-medium">{t('overview.browserDb.title')}</h2>
          {/* The heading was already true and the paragraph under it denied
              it: "this build keeps everything in memory for the session, so a
              reload starts from the demo data again". Records go to IndexedDB
              as you work now, so what is left to warn about is the thing that
              is still true — the database is on this one machine, nothing
              syncs it anywhere, and a browser can clear it. */}
          <p className="mt-1.5 text-sm text-text-2">
            <Trans
              t={t}
              i18nKey="overview.browserDb.body"
              components={{ kbd: KBD, settings: <Go to={settingsPath()} /> }}
            />
          </p>
        </div>
      </div>
    </Panel>
  )
}
