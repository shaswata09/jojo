import { Link } from 'react-router'
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
  return (
    <>
      <PageHeader
        title="Assistant"
        subtitle="Connected to your model, and able to act on your records. Everything it does is listed as it happens."
        actions={
          canClear ? (
            <Button variant="ghost" size="sm" disabled={busy} onClick={onClear}>
              Clear
            </Button>
          ) : null
        }
      />

      <p role="status" className="rounded-lg border border-hairline px-4 py-3 text-sm text-text-2">
        Answers come from <span className="font-mono text-text-1">{model}</span> at{' '}
        <span className="font-mono text-text-1">{endpoint}</span>, which can call{' '}
        <Link to="/guide" className="underline underline-offset-2">
          {CATALOG.length} tools
        </Link>{' '}
        on this device. Nothing is sent anywhere else.
      </p>
    </>
  )
}
