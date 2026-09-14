import { Check, Pipette } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The swatch that is not one of the eight: any colour, off the spectrum.
 *
 * A native `<input type="color">` under a disc that looks like its neighbours.
 * That is a deliberate choice over a hand-built wheel, and the reasons are in
 * descending order of how much they matter:
 *
 *   - It is the operating system's own picker, so it arrives with a spectrum, a
 *     hex field, recently-used colours and — on macOS — an eyedropper for
 *     lifting a colour off anything on screen. None of that is code here.
 *   - It is reachable by keyboard and announced by screen readers without any
 *     of the ARIA a custom canvas would need to fake.
 *   - A colour wheel drawn on a canvas is ~200 lines that have to answer for
 *     touch, pointer capture, hue/saturation maths and the two themes. This
 *     file is the fifth of that and cannot get any of it wrong.
 *
 * What it costs, stated: the picker looks like the platform rather than like
 * jojo, and the browser decides when it commits — Safari and Firefox fire
 * `change` on every drag. Callers debounce the write rather than this hiding
 * the events, because how often to persist is the caller's question.
 */
export function SpectrumSwatch({
  value,
  onPick,
  selected,
  label = 'Any colour',
  className,
}: {
  /** The colour the disc shows: the custom one in use, or a hint of what this does. */
  value: string | undefined
  onPick: (hex: string) => void
  selected?: boolean
  label?: string
  className?: string
}) {
  return (
    <label
      title={label}
      className={cn(
        'group/swatch relative grid size-6 cursor-pointer place-items-center rounded-full',
        className,
      )}
    >
      <span className="sr-only">{label}</span>
      {/*
        Sized to the disc and made invisible rather than hidden: `display: none`
        or `visibility: hidden` on a colour input stops the picker opening at
        all in Safari, and a `sr-only` clip does the same on some builds. It
        stays a real, full-size target — which is also what makes the whole
        24px box clickable rather than just the disc.
      */}
      <input
        type="color"
        value={value ?? '#7c3aed'}
        onChange={(event) => onPick(event.target.value)}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
      />
      <span
        aria-hidden
        className={cn(
          'grid size-4 place-items-center rounded-full text-panel transition-transform group-hover/swatch:scale-110',
          // The rainbow says "anything", and is a conic gradient rather than an
          // image so it costs no request and stays sharp at any zoom. A custom
          // colour in use replaces it: the swatch then shows what was chosen,
          // which is what every other disc in the row does.
          value === undefined &&
            'bg-[conic-gradient(from_0deg,#ef4444,#eab308,#22c55e,#06b6d4,#3b82f6,#a855f7,#ec4899,#ef4444)]',
        )}
        style={value === undefined ? undefined : { background: value }}
      >
        {selected ? (
          <Check className="size-2.5" strokeWidth={3.5} />
        ) : value === undefined ? (
          <Pipette className="size-2.5 text-panel" strokeWidth={2.5} />
        ) : null}
      </span>
    </label>
  )
}
