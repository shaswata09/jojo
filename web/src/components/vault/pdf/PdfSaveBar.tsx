import { Download, TriangleAlert } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * The name, the two ways out, and whatever went wrong. Shared by all three panels.
 *
 * One component because the three operations end the same way and had no
 * business disagreeing about it: every result is a NEW document, filed in the
 * vault, optionally handed to the browser's downloader as well. "Save" and
 * "Save and download" rather than a choice between them — a person who wants
 * the file on their disk almost always also wants it kept, and the version that
 * offered only a download meant the work was gone the moment the tab closed.
 */
export function PdfSaveBar({
  name,
  suggested,
  onName,
  onSave,
  onDownload,
  busy,
  error,
  disabled,
  hint,
  icon: Icon,
  saveLabel,
}: {
  name: string
  /** What it will be called if the box is left empty. */
  suggested: string
  onName: (name: string) => void
  onSave: () => void
  onDownload: () => void
  busy: boolean
  error: string | null
  disabled: boolean
  hint?: string
  icon: LucideIcon
  /** The save button's whole label — 'Merge and save'. */
  saveLabel: string
}) {
  const { t } = useTranslation('vault')
  return (
    <div className="flex flex-col gap-2 border-t border-hairline pt-3">
      {error === null ? null : (
        <p
          // `alert`, so the message reaches a screen reader when it appears
          // rather than only when something happens to move focus near it.
          role="alert"
          className="flex items-start gap-1.5 rounded-lg border border-danger-border bg-danger-soft px-2 py-1.5 text-sm text-danger"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="min-w-0">{error}</span>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="h-8 min-w-0 flex-1 basis-56"
          value={name}
          placeholder={suggested}
          aria-label={t('pdf.save.nameLabel')}
          onChange={(event) => onName(event.target.value)}
        />
        <Button disabled={disabled || busy} onClick={onSave}>
          <Icon aria-hidden /> {busy ? t('pdf.save.working') : saveLabel}
        </Button>
        <Button variant="outline" disabled={disabled || busy} onClick={onDownload}>
          <Download aria-hidden /> {t('pdf.save.alsoDownload')}
        </Button>
      </div>
      <p className="text-xs text-text-3">
        {hint ? `${hint} ` : ''}
        {t('pdf.save.footnote')}
      </p>
      <span className="sr-only" aria-live="polite">
        {busy ? t('pdf.save.workingSpoken') : ''}
      </span>
    </div>
  )
}
