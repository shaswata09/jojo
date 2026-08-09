import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * The coarse-pointer height is written as an arbitrary variant rather than a
 * breakpoint: `pointer: coarse` asks about the input device, and a 32px field
 * is only hard to hit with a finger — it is fine with a mouse in a 390px
 * window, which is what an `sm:` rule would have grown.
 *
 * Tailwind ships `pointer-*` variants in v4, but a class naming a variant this
 * project's build does not emit fails silently, so this stays explicit and
 * greppable alongside the `[@media(hover:none)]` rules in Calendar.
 */
const COARSE_TOUCH = '[@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:px-3'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        COARSE_TOUCH,
        'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
