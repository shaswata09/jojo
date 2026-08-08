import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

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
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Local-first: no telemetry endpoint to report to, so the console is it.
    console.error('Unhandled render error:', error, info.componentStack)
    this.props.onError?.(error)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback !== undefined) return this.props.fallback

    return (
      <div className="grid min-h-dvh place-items-center p-5">
        <div className="surface max-w-md rounded-lg px-5 py-5">
          <h1 className="text-lg font-semibold">Something broke</h1>
          <p className="mt-2 text-sm text-text-2">
            Your data is untouched — this is a display error. Reloading usually clears it.
          </p>
          <pre className="bg-input-bg mt-3 max-h-40 overflow-auto rounded-sm p-3 font-mono text-xs text-text-3">
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
