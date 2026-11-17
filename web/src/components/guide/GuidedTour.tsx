import { Compass } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useTour } from '@/components/tour/tour-context'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * The button that starts the guided tour — or resumes it where the reader left
 * off. The tour itself walks the real app with a spotlight and lives in the
 * app shell (`components/tour`), so it can cross pages; this is only a way in.
 */
export function TourLauncher({ className }: { className?: string }) {
  const { t } = useTranslation('guide')
  const tour = useTour()
  const resume = tour.saved > 0
  return (
    <Button
      variant="outline"
      className={cn('gap-1.5', className)}
      onClick={() => tour.start()}
      disabled={tour.active}
    >
      <Compass aria-hidden />
      {resume ? t('tour.resume', { step: tour.saved + 1, total: tour.total }) : t('tour.start')}
    </Button>
  )
}
