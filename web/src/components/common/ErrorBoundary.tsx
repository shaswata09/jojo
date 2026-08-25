import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { reportError } from '@/lib/report-error'

type Props = {
  children: ReactNode
  /**
   * Rendered instead of the full-page treatment when this boundary is guarding
   * one widget rather than the whole app.
   */
  fallback?: ReactNode
  /** Lets a parent react to the failure — swap in its own placeholder, say. */
  onError?: (error: Error) => void
}
type State = { error: Error | null }

/**
 * Catches render errors so one broken view does not blank the entire app.
 *
 * Still a class component: React has no hook equivalent, and
 * `react-error-boundary` would be a dependency for ~40 lines.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    /*
     * Recorded, and this is not redundant with `listenForCrashes`.
     *
     * That listener is on `window.onerror` and `unhandledrejection`, and React
     * catches a render error before it reaches either — so every crash this
     * boundary exists for was missing from the list in Settings, which is the
     * one place a person is told to look. The console line below is a developer
     * with the tab open; this is the person who hit it three days ago.
     *
     * Web reports stay on this device: Google ships no browser Crashlytics.
     */
    // `fatal` when this is the app-wide boundary: the whole screen is gone.
    // A widget boundary has a fallback and the app carries on, which is a
    // different severity and worth counting separately.
    reportError(this.props.fallback === undefined ? 'render' : 'route', error, {
      fatal: this.props.fallback === undefined,
    })

    // Named for what this boundary DID, not "unhandled render error", which is
    // what it used to say. Every line it prints is by definition one it caught,
    // and the widget boundaries print it on their designed path — a machine with
    // no GPU logs it once as `SplineRobot` hands over to the 2D mascot, exactly
    // as intended. An audit read that line as a crash the build had missed and
    // went looking for the bug; a boundary that reports a working fallback as an
    // unhandled failure is spending someone's afternoon every time it fires.
    const scope = this.props.fallback === undefined ? 'app' : 'widget'
    console.error(`Render error caught by the ${scope} boundary:`, error, info.componentStack)
    this.props.onError?.(error)
  }

  override render() {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback !== undefined) return this.props.fallback

    return (
      <div className="grid min-h-dvh place-items-center p-5">
        <div className="surface max-w-md rounded-lg px-5 py-5">
          <h1 className="text-lg font-semibold">Something broke</h1>
          {/*
           * Promised nothing about the records on purpose.
           *
           * This read "Your data is untouched — this is a display error", which
           * was a guess even while the store was in memory: a crash part-way
           * through a multi-collection write left the store half-edited, and the
           * sentence told the user it had not. Once records are on disk the same
           * sentence starts covering a write that never reached IndexedDB, and a
           * reassurance that turns out to be wrong is worse than no reassurance
           * — the user stops reloading, and loses the work anyway.
           */}
          <p className="mt-2 text-sm text-text-2">
            A view failed to render. Try again re-mounts it without reloading the page.
          </p>
          {/*
           * `bg-input-bg` named no token, so Tailwind emitted no rule for it and
           * the trace sat on the panel background with no recess at all — a
           * silent failure, because an unknown utility is not an error. `well`
           * is the token the rest of the app uses for a sunken block.
           */}
          <pre className="mt-3 max-h-40 overflow-auto rounded-sm bg-well p-3 font-mono text-xs text-text-3">
            {error.message}
          </pre>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-4 rounded-sm border border-accent-border bg-accent-soft px-4 py-2 text-sm font-medium text-accent"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }
}
