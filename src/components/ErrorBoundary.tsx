import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw, X, RefreshCw } from 'lucide-react';

export interface ErrorBoundaryProps {
  children?: ReactNode;
  fallbackTitle?: string;
  onDismiss?: () => void;
  onReset?: () => void;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  isRoot?: boolean;
  resetKeys?: any[];
}

export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] Caught unhandled runtime error:', error, errorInfo);
    this.setState({ errorInfo });
    this.props.onError?.(error, errorInfo);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (this.state.hasError && this.props.resetKeys && prevProps.resetKeys) {
      const hasChanged = this.props.resetKeys.some(
        (key, index) => !Object.is(key, prevProps.resetKeys?.[index])
      );
      if (hasChanged) {
        this.handleReset();
      }
    }
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    });
    this.props.onReset?.();
  };

  handleDismiss = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    });
    this.props.onDismiss?.();
  };

  handleReloadPage = (): void => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { fallbackTitle, fallback, isRoot, onDismiss } = this.props;
    const { error } = this.state;

    if (fallback) {
      if (typeof fallback === 'function') {
        return fallback(error || new Error('Unknown error'), this.handleReset);
      }
      return fallback;
    }

    const errorMessage = error?.message || (error ? String(error) : 'An unexpected error occurred');
    const titleText = fallbackTitle ? `${fallbackTitle} — Application Error` : 'Application Error — Unhandled Exception';

    const panelContent = (
      <div className="w-full max-w-lg bg-[#c0c0c0] w95-border w95-shadow flex flex-col font-tahoma text-xs select-none">
        <div className="bg-gradient-to-r from-[#800000] via-[#a00000] to-[#800000] text-white px-2 py-1 flex items-center justify-between font-bold text-xs">
          <div className="flex items-center gap-1.5 truncate">
            <AlertTriangle size={13} className="text-yellow-300 shrink-0" />
            <span className="truncate">{titleText}</span>
          </div>
          {(onDismiss || !isRoot) && (
            <button
              onClick={this.handleDismiss}
              className="w-4 h-4 bg-w95-gray w95-border flex items-center justify-center text-black hover:bg-red-700 hover:text-white active:translate-x-0.5 text-[10px] font-bold shrink-0 ml-2"
              title="Dismiss"
            >
              <X size={10} />
            </button>
          )}
        </div>

        <div className="p-3 space-y-3 bg-[#ece9d8]">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-red-600 border border-white shadow-sm flex items-center justify-center text-white shrink-0 font-bold text-base select-none">
              ✕
            </div>
            <div>
              <div className="font-bold text-sm text-gray-900 leading-tight">
                {fallbackTitle ? `A fatal error occurred in ${fallbackTitle}.` : 'A fatal application error has occurred.'}
              </div>
              <div className="text-gray-600 text-[11px] mt-0.5">
                The component crashed and was terminated to protect the web OS environment.
              </div>
            </div>
          </div>

          <div className="bg-white w95-border-inset p-2.5 space-y-1.5">
            <div className="font-bold text-red-800 text-[10px] uppercase tracking-wider">
              Diagnostic Information:
            </div>
            <div className="text-red-700 font-mono text-xs break-words whitespace-pre-wrap select-text">
              {errorMessage}
            </div>
            {error?.stack && (
              <details className="mt-1 pt-1 border-t border-gray-200">
                <summary className="text-[10px] text-gray-500 hover:text-gray-800 cursor-pointer font-sans select-none">
                  View Stack Trace
                </summary>
                <pre className="mt-1 text-[10px] text-gray-700 bg-gray-50 p-1.5 border border-gray-300 overflow-auto max-h-24 whitespace-pre font-mono select-text leading-tight">
                  {error.stack}
                </pre>
              </details>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            {onDismiss && (
              <button
                onClick={this.handleDismiss}
                className="btn-w95 px-3 py-1 text-xs"
              >
                Dismiss
              </button>
            )}
            <button
              onClick={this.handleReset}
              className="btn-w95 btn-w95-primary px-3 py-1 text-xs flex items-center gap-1"
            >
              <RotateCcw size={12} />
              <span>Reload</span>
            </button>
            {isRoot && (
              <button
                onClick={this.handleReloadPage}
                className="btn-w95 px-3 py-1 text-xs flex items-center gap-1"
              >
                <RefreshCw size={12} />
                <span>Restart Web OS</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );

    if (isRoot) {
      return (
        <div className="fixed inset-0 bg-[#008080] flex items-center justify-center p-4 z-[130]">
          {panelContent}
        </div>
      );
    }

    return (
      <div className="fixed inset-0 bg-black/25 flex items-center justify-center p-4 z-[120]">
        {panelContent}
      </div>
    );
  }
}
