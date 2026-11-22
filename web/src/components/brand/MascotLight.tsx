import { cn } from '@/lib/utils'
import './mascot-light.css'

/**
 * A faint beam of light falling into the mascot card from beyond its top-left
 * corner. Decoration only: hidden from assistive tech, never takes a pointer,
 * and sits at z-index 1, under the robot. It fades in once per mount and then
 * holds still; the look and the entrance live in `mascot-light.css`.
 */
export function MascotLight({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn('jojo-mascot-light', className)}>
      <div className="jojo-mascot-light-beam" />
    </div>
  )
}
