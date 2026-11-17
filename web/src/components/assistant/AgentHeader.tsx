import { Link } from 'react-router'
import { Trans, useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { CATALOG } from '@jojo/service/agent/catalog'

/** The connected Assistant's title, its Clear, and which model at which address answers. */
export function AgentHeader({
  model,
  endpoint,
  canClear,
  busy,
  onClear,
}: {
  model: string
  endpoint: string
  canClear: boolean
  busy: boolean
  onClear: () => void
}) {
  const { t } = useTranslation('assistant')
  return (
    <>
      <PageHeader
        title={t('common.title')}
        subtitle={t('header.subtitle')}
        actions={
          canClear ? (
            <Button variant="ghost" size="sm" disabled={busy} onClick={onClear}>
              {t('header.clear')}
            </Button>
          ) : null
        }
      />

      <p role="status" className="rounded-lg border border-hairline px-4 py-3 text-sm text-text-2">
        <Trans
          t={t}
          i18nKey="header.connected"
          count={CATALOG.length}
          values={{ model, endpoint }}
          components={{
            mono: <span className="font-mono text-text-1" />,
            tools: <Link to="/guide" className="underline underline-offset-2" />,
          }}
        />
      </p>
    </>
  )
}
