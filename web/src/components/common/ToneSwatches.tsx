import { Check } from 'lucide-react'
import { TONE_ORDER, inkFill, toneFill, toneName } from '@/components/common/label-display'
import { SpectrumSwatch } from '@/components/common/SpectrumSwatch'
import type { LabelTone } from '@/data/labels'
import { useTheme } from '@/lib/theme-context'
import { cn } from '@/lib/utils'

/**
 * The palette, as pickable discs.
 *
 * The tick is the selection cue rather than a ring, because a ring drawn with
 * `outline` would fight the app's global focus ring and one drawn with a border
 * shrinks the disc as you click through them. It is painted `text-panel`, which
 * is white on the light theme's dark fills and near-black on the dark theme's
 * bright ones — the one token that stays legible on all eight in both themes.
 *
 * The disc and the button are two elements rather than one because they answer
 * two different questions. The disc is 16px because a row of them has to sit in
 * a 240px popover and still read as a swatch row; the button used to be 16px
 * too, and measured on a phone that was a 16x16 tap target with 22px between
 * centres — failing WCAG 2.5.8 on the size rule AND on the spacing exception,
 * in the smallest interactive control in the app, which appears in every
 * keyword-recolour popover on /settings, /applications and /vault. The button
 * is now the 24px box the rule asks for and the disc inside it is untouched.
 */
export function ToneSwatches({
  value,
  ink,
  onChange,
  label,
  className,
}: {
  value: LabelTone
  /** The custom colour in use, if the eight were not enough. */
  ink?: string
  /**
   * `ink` is `null` when one of the eight was picked and a hex when the
   * spectrum was — never `undefined`, so a caller cannot forget to clear a
   * custom colour it is replacing.
   */
  onChange: (tone: LabelTone, ink: string | null) => void
  /** The keyword being recoloured, so the group says which one it belongs to. */
  label: string
  className?: string
}) {
  const { theme } = useTheme()

  return (
    <div
      role="group"
      aria-label={`Colour for ${label}`}
      /*
       * Wraps, and that is what made room for the palette. Nine 24px targets
       * with 6px between them is 264px of a 240px popover before its padding,
       * so a single row either overflowed or shrank the targets back below the
       * 24px WCAG 2.5.8 asks for — which is the exact regression the note above
       * records fixing.
       *
       * 148px, which takes five: the row comes out five and four rather than
       * four, four and the spectrum stranded on a third line — measured on the
       * settings list, where a third line makes every keyword row taller than
       * the keyword in it.
       */
      className={cn('flex max-w-[9.25rem] flex-wrap items-center gap-1.5', className)}
    >
      {TONE_ORDER.map((tone) => (
        <button
          key={tone}
          type="button"
          aria-pressed={tone === value}
          aria-label={toneName[tone]}
          title={toneName[tone]}
          onClick={() => onChange(tone, null)}
          className="group/swatch grid size-6 cursor-pointer place-items-center rounded-full"
        >
          <span
            aria-hidden
            className={cn(
              'grid size-4 place-items-center rounded-full text-panel transition-transform group-hover/swatch:scale-110',
              toneFill[tone],
            )}
          >
            {/* Ticked only when no custom colour is in play: with one, none of
                the eight is what the chip is wearing, and two ticks in a row
                of nine would be a lie about one of them. */}
            {tone === value && ink === undefined ? (
              <Check className="size-2.5" strokeWidth={3.5} />
            ) : null}
          </span>
        </button>
      ))}

      {/* The ninth, and last for a reason: the eight are the answer almost
          every time, and a picker that opens the operating system's colour
          panel belongs after them rather than in front. Picking a preset
          passes `null` and drops whatever custom colour was there. */}
      <SpectrumSwatch
        value={ink === undefined ? undefined : inkFill(ink, theme)}
        selected={ink !== undefined}
        label={`Any colour for ${label}`}
        onPick={(hex) => onChange(value, hex)}
      />
    </div>
  )
}
