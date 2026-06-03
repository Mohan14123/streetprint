/**
 * src/app/components/ErrorBoundary.tsx
 * Global error boundary — catches component crashes and shows a fallback UI
 * instead of white-screening the entire app.
 * Theme-aware: uses CSS custom properties.
 */
import { Component, type ReactNode, type ErrorInfo } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log to console in dev — replace with structured logging in production
    console.error('[ErrorBoundary] Uncaught error:', error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          className="flex items-center justify-center min-h-screen"
          style={{ background: 'var(--sp-bg-primary, #0D1117)' }}
        >
          <div className="flex flex-col items-center justify-center px-8 text-center max-w-sm">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
              style={{ background: 'var(--sp-status-danger-bg, rgba(239, 68, 68, 0.1))' }}
            >
              <AlertTriangle
                className="w-8 h-8"
                style={{ color: 'var(--sp-status-danger-text, #ef4444)' }}
              />
            </div>
            <h1
              className="text-xl font-bold mb-2"
              style={{ color: 'var(--sp-text-primary, #e2e8f0)' }}
            >
              Something went wrong
            </h1>
            <p
              className="text-sm mb-6 max-w-[280px]"
              style={{ color: 'var(--sp-text-muted, #64748b)' }}
            >
              The app encountered an unexpected error. Try reloading.
            </p>
            {this.state.error && (
              <pre
                className="text-xs rounded-xl p-3 mb-6 max-w-full overflow-x-auto text-left"
                style={{
                  color: 'var(--sp-status-danger-text, #ef4444)',
                  background: 'var(--sp-status-danger-bg, rgba(239, 68, 68, 0.05))',
                  border: '1px solid var(--sp-border, rgba(255,255,255,0.1))',
                }}
              >
                {this.state.error.message}
              </pre>
            )}
            <button
              onClick={this.handleReload}
              className="h-10 px-6 rounded-xl text-sm flex items-center gap-2 transition-colors"
              style={{
                background: 'var(--sp-bg-input, rgba(255,255,255,0.1))',
                border: '1px solid var(--sp-border-strong, rgba(255,255,255,0.1))',
                color: 'var(--sp-text-primary, #e2e8f0)',
              }}
            >
              <RefreshCw className="w-4 h-4" />
              Reload App
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
