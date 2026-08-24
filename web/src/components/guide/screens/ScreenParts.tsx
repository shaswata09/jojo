import { Link } from 'react-router'
import { Unplug } from 'lucide-react'
import type { ReactNode } from 'react'
import { Panel, PanelTitle } from '@/components/common/Panel'

/**
 * A link into the app, styled once.
 *
 * The same trio as the landing page's `Go`, and deliberately a second copy
 * rather than an export: the two pages are content packages that ship
 * separately, and a shared one-line component is the kind of thing that grows a
 * `variant` prop the first time one of them wants a different underline.
 */
export function Go({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="text-accent underline decoration-1 underline-offset-4 hover:decoration-2">
      {children}
    </Link>
  )
}

/** A parameter, a path or a file name, set as one. */
export function Code({ children }: { children: string }) {
  return (
    <code className="rounded-sm border border-hairline bg-well px-1 py-px font-mono break-all">
      {children}
    </code>
  )
}

/**
 * One screen's section: a heading, where the page is reached from, and a link
 * that goes there.
 *
 * The door is in the heading rather than in the first paragraph because that is
 * the question this page is opened with — six of the thirteen routes are not in
 * the sidebar, and a reader who has to read a paragraph to find out where a
 * page lives has been made to read the wrong thing.
 */
export function Screen({
  id,
  title,
  where,
  to,
  open,
  children,
}: {
  id: string
  title: string
  /** Where the page is reached from, in three or four words. */
  where: string
  to: string
  /** What the link says. Defaults to the title. */
  open?: string
  children: ReactNode
}) {
  return (
    <Panel id={id} className="scroll-mt-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <PanelTitle className="mb-0" hint={where}>
          {title}
        </PanelTitle>
        <p className="shrink-0 text-sm">
          <Go to={to}>Open {open ?? title}</Go>
        </p>
      </div>
      {children}
    </Panel>
  )
}

/**
 * What a screen looks like it does and does not.
 *
 * Same shape everywhere it appears, which is the point of it: by the third one
 * a reader has learned that this border means a claim is being withdrawn, and
 * starts trusting the pages that carry no such block. Warning-bordered but not
 * filled — six filled panels down one page would read as six errors.
 */
export function NotConnected({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-3.5 rounded-lg border border-warning-border px-3.5 py-3">
      <p className="flex items-center gap-2 text-xs font-medium text-warning">
        <Unplug className="size-3.5 shrink-0" strokeWidth={1.8} aria-hidden />
        {title}
      </p>
      <div className="mt-1.5 text-sm text-text-2">{children}</div>
    </div>
  )
}

/** What a copied link off this page carries. Absent where the answer is nothing. */
export function Address({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3.5 border-t border-hairline pt-3 text-xs text-text-3">
      <span className="font-medium text-text-2">In the address bar</span> {children}
    </p>
  )
}
