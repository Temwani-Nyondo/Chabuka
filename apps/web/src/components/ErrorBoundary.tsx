import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

// Without this, any render error blanks the whole app. Show what happened and
// a way back instead.
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI crashed:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page page-narrow">
        <h1>Something broke</h1>
        <div className="card">
          <p>This screen hit an error. Your data is safe.</p>
          <p className="muted">{this.state.error.message}</p>
          <a className="btn btn-primary" href="/home">Back to Home</a>
        </div>
      </div>
    );
  }
}
