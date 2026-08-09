import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import './transfer.css'

export type TransferTitleProps = {
  /**
   * The headline. Pass a string and it is split on whitespace; pass an array to
   * control the grouping yourself — "Job Scout" as one unit rather than two
   * words drifting apart.
   */
  title: string | string[]
  subtitle?: ReactNode
  /** Optional call to action, rendered with the original `explore-btn` treatment. */
  action?: { label: string; onClick?: () => void }
  /** Milliseconds between consecutive words. */
  stagger?: number
  className?: string
}

type TitleStyle = CSSProperties & {
  '--i'?: number
  '--transfer-subtitle-delay'?: string
  '--transfer-cta-delay'?: string
}

const DEFAULT_STAGGER = 110

/**
 * The word-by-word reveal from the transfer scene, as its own component.
 *
 * Kept separate from the canvas because the copy is not this package's to
 * decide — the scene is a backdrop, and whatever composes it supplies the
 * words. It renders no `<h1>`: the route owns the document's single heading,
 * so the level comes in from outside via `as`-free composition (wrap it, or
 * place it inside the heading the page already has).
 */
export function TransferTitle({
  title,
  subtitle,
  action,
  stagger = DEFAULT_STAGGER,
  className,
}: TransferTitleProps) {
  const words = Array.isArray(title) ? title : title.split(/\s+/).filter(Boolean)

  // The subtitle and the button wait for the last word, so a long headline does
  // not get talked over by its own supporting copy.
  const tail = words.length * stagger
  const scopeStyle: TitleStyle = {
    '--transfer-subtitle-delay': `${tail + 180}ms`,
    '--transfer-cta-delay': `${tail + 380}ms`,
  }

  return (
    <div className={cn('transfer-scope', className)} style={scopeStyle}>
      {/* One accessible string for the whole headline. Screen readers get the
          sentence; the per-word spans exist only to carry animation delays, and
          reading them out one at a time would be worse than useless. */}
      <p className="sr-only">{words.join(' ')}</p>
      <span aria-hidden className="block text-balance">
        {words.map((word, i) => (
          <span key={`${word}-${i}`} className="fade-in" style={{ '--i': i } as TitleStyle}>
            {word}
            {i < words.length - 1 ? ' ' : null}
          </span>
        ))}
      </span>

      {subtitle ? <span className="fade-in-subtitle">{subtitle}</span> : null}

      {action ? (
        <button type="button" className="explore-btn" onClick={action.onClick}>
          {action.label}
          <span aria-hidden className="explore-arrow">
            <svg viewBox="0 0 16 16" className="arrow-svg">
              <path d="M3 8h9.5M8.5 4l4 4-4 4" />
            </svg>
          </span>
        </button>
      ) : null}
    </div>
  )
}
