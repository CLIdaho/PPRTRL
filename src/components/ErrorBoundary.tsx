import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Without this, any thrown render error unmounts the whole tree and leaves a
 * blank page — the least helpful thing an app can do to someone who is trying
 * to keep a record of something that matters.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Papertrail hit an error:', error, info)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="page">
        <div className="card stack" style={{ marginTop: 32 }}>
          <h1 style={{ fontSize: 20 }}>Something went wrong</h1>
          <p className="small muted">
            Papertrail hit an error while drawing this screen. <strong>Your records are safe</strong> —
            they are stored on this device and nothing here deletes them.
          </p>
          <p className="small muted">
            Try going back to the timeline. If it keeps happening, open Settings and download a
            backup so you have a copy outside the app.
          </p>
          <details>
            <summary className="small" style={{ cursor: 'pointer' }}>Technical details</summary>
            <pre
              className="mono tiny"
              style={{ whiteSpace: 'pre-wrap', marginTop: 8, color: 'var(--text-faint)' }}
            >
              {error.message}
            </pre>
          </details>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary" onClick={() => { window.location.hash = '#/'; window.location.reload() }}>
              Back to the timeline
            </button>
          </div>
        </div>
      </div>
    )
  }
}
