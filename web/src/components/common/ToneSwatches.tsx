import { Check } from 'lucide-react'
import { TONE_ORDER, toneFill, toneName } from '@/components/common/label-display'
import type { LabelTone } from '@/data/labels'
import { cn } from '@/lib/utils'

/**
 * The five tones, as pickable discs.
 *
 * The tick is the selection cue rather than a ring, because a ring drawn with
 * `outline` would fight the app's global focus ring and one drawn with a border
 * shrinks the disc as you click through them. It is painted `text-panel`, which
 * is white on the light theme's dark fills and near-black on the dark theme's
 * bright ones — the one token that stays legible on all five in both themes.
 */
export function ToneSwatches({
  value,
  onChange,
  label,
  className,
}: {
  value: LabelTone
  onChange: (tone: LabelTone) => void
  /** The keyword being recoloured, so the group says which one it belongs to. */
  label: string
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={`Colour for ${label}`}
      className={cn('flex items-center gap-1.5', className)}
    >
      {TONE_ORDER.map((tone) => (
        <button
          key={tone}
          type="button"
          aria-pressed={tone === value}
          aria-label={toneName[tone]}
          title={toneName[tone]}
          onClick={() => onChange(tone)}
          className={cn(
            'grid size-4 cursor-pointer place-items-center rounded-full text-panel transition-transform hover:scale-110',
            toneFill[tone],
          )}
        >
          {tone === value ? <Check className="size-2.5" strokeWidth={3.5} aria-hidden /> : null}
        </button>
      ))}
    </div>
  )
}
