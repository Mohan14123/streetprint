/**
 * src/app/components/ErrorBoundary.tsx
 * Global error boundary — catches component crashes and shows a fallback UI
 * instead of white-screening the entire app.
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
        <div className="flex items-center justify-center min-h-screen bg-black">
          <div className="relative w-full h-[100dvh] sm:h-[844px] sm:w-[390px] sm:rounded-[3rem] overflow-hidden bg-[#0D1117] sm:border-[8px] border-[#1f2937] shadow-2xl flex flex-col items-center justify-center px-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mb-4">
              <AlertTriangle className="w-8 h-8 text-red-400" />
            </div>
            <h1 className="text-xl font-bold text-white mb-2">Something went wrong</h1>
            <p className="text-sm text-slate-500 mb-6 max-w-[280px]">
              The app encountered an unexpected error. Try reloading.
            </p>
            {this.state.error && (
              <pre className="text-xs text-red-400/60 bg-red-500/5 border border-red-500/10 rounded-xl p-3 mb-6 max-w-full overflow-x-auto text-left">
                {this.state.error.message}
              </pre>
            )}
            <button
              onClick={this.handleReload}
              className="h-10 px-6 bg-white/10 border border-white/10 rounded-xl text-sm text-white flex items-center gap-2 hover:bg-white/15 transition-colors"
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
