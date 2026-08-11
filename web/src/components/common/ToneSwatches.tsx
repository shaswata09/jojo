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
 *
 * The disc and the button are two elements rather than one because they answer
 * two different questions. The disc is 16px because five of them have to sit in
 * a 240px popover and still read as a swatch row; the button used to be 16px
 * too, and measured on a phone that was a 16x16 tap target with 22px between
 * centres — failing WCAG 2.5.8 on the size rule AND on the spacing exception,
 * in the smallest interactive control in the app, which appears in every
 * keyword-recolour popover on /settings, /applications and /vault. The button
 * is now the 24px box the rule asks for and the disc inside it is untouched.
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
          className="group/swatch grid size-6 cursor-pointer place-items-center rounded-full"
        >
          <span
            aria-hidden
            className={cn(
              'grid size-4 place-items-center rounded-full text-panel transition-transform group-hover/swatch:scale-110',
              toneFill[tone],
            )}
          >
            {tone === value ? <Check className="size-2.5" strokeWidth={3.5} /> : null}
          </span>
        </button>
      ))}
    </div>
  )
}
