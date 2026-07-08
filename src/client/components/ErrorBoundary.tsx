import { Component, type ErrorInfo, type ReactNode } from 'react'

import { logClient } from '../logging'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  failed: boolean
}

/**
 * A render crash must never strand the table on a blank page: show a
 * reload path and ship the error to the host log.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logClient('error', 'react.error', error.message, {
      stack: error.stack,
      componentStack: info.componentStack ?? undefined,
    })
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <main className="app-shell">
        <section className="app-shell__body">
          <div className="card" role="alert">
            <h2 className="card__title">Something went wrong</h2>
            <p>The screen crashed. The error was sent to the host log.</p>
            <button
              type="button"
              className="button button--primary"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        </section>
      </main>
    )
  }
}
