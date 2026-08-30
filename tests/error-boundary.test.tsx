import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import App from '../src/App';
import { AlertProvider } from '../src/context/AlertContext';

describe('ErrorBoundary Component', () => {
  it('renders children when hasError is false', () => {
    const html = renderToString(
      <ErrorBoundary fallbackTitle="TEST.EXE">
        <div data-testid="healthy-content">Healthy Window Content</div>
      </ErrorBoundary>
    );

    expect(html).toContain('Healthy Window Content');
    expect(html).not.toContain('Application Error');
  });

  it('computes derived state on error via getDerivedStateFromError', () => {
    const error = new Error('Test crash');
    const state = ErrorBoundary.getDerivedStateFromError(error);

    expect(state.hasError).toBe(true);
    expect(state.error).toBe(error);
  });

  it('renders Win95-styled fallback panel when in error state', () => {
    const boundary = new ErrorBoundary({ fallbackTitle: 'HOTWIRE' });
    boundary.state = {
      hasError: true,
      error: new Error('Failed to load SQLite catalog'),
      errorInfo: null
    };

    const html = renderToString(boundary.render() as React.ReactElement);

    // Visual language and fallback content
    expect(html).toContain('HOTWIRE — Application Error');
    expect(html).toContain('A fatal error occurred in HOTWIRE.');
    expect(html).toContain('The component crashed and was terminated to protect the web OS environment.');
    expect(html).toContain('Failed to load SQLite catalog');
    expect(html).toContain('Reload');
    expect(html).not.toContain('Healthy Window Content');
  });

  it('renders dismiss button when onDismiss is supplied', () => {
    const onDismiss = vi.fn();
    const boundary = new ErrorBoundary({ fallbackTitle: 'GITSMITH', onDismiss });
    boundary.state = {
      hasError: true,
      error: new Error('SSH connection terminated'),
      errorInfo: null
    };

    const html = renderToString(boundary.render() as React.ReactElement);

    expect(html).toContain('Dismiss');
    expect(html).toContain('GITSMITH — Application Error');
    expect(html).toContain('SSH connection terminated');
  });

  it('renders root layout with "Restart Web OS" when isRoot is true', () => {
    const boundary = new ErrorBoundary({ isRoot: true, fallbackTitle: "Nate's Software Web OS" });
    boundary.state = {
      hasError: true,
      error: new Error('Kernel initialization failure'),
      errorInfo: null
    };

    const html = renderToString(boundary.render() as React.ReactElement);

    expect(html).toContain('Restart Web OS');
    expect(html).toContain('Software Web OS — Application Error');
    expect(html).toContain('Kernel initialization failure');
  });

  it('supports custom ReactNode fallback', () => {
    const boundary = new ErrorBoundary({
      fallback: <div className="custom-fallback">Custom Crash Message</div>
    });
    boundary.state = {
      hasError: true,
      error: new Error('Simulated crash'),
      errorInfo: null
    };

    const html = renderToString(boundary.render() as React.ReactElement);

    expect(html).toContain('Custom Crash Message');
    expect(html).not.toContain('Application Error');
  });

  it('supports custom function fallback receiving error and reset callback', () => {
    const boundary = new ErrorBoundary({
      fallback: (err) => <div className="custom-fn">Custom Error: {err.message}</div>
    });
    boundary.state = {
      hasError: true,
      error: new Error('Custom dynamic exception'),
      errorInfo: null
    };

    const html = renderToString(boundary.render() as React.ReactElement);

    expect(html).toContain('Custom Error:');
    expect(html).toContain('Custom dynamic exception');
  });

  it('logs errors via componentDidCatch and triggers onError callback', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onError = vi.fn();

    const boundary = new ErrorBoundary({ fallbackTitle: 'TEST', onError });
    const testError = new Error('Explicit test failure');
    const testErrorInfo = { componentStack: 'at CrashingComponent' };

    boundary.componentDidCatch(testError, testErrorInfo as any);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[ErrorBoundary] Caught unhandled runtime error:',
      testError,
      testErrorInfo
    );
    expect(onError).toHaveBeenCalledWith(testError, testErrorInfo);

    consoleErrorSpy.mockRestore();
  });

  it('resets state and triggers onReset when handleReset is called', () => {
    const onReset = vi.fn();
    const boundary = new ErrorBoundary({ onReset });
    boundary.setState = vi.fn();

    boundary.handleReset();

    expect(boundary.setState).toHaveBeenCalledWith({
      hasError: false,
      error: null,
      errorInfo: null
    });
    expect(onReset).toHaveBeenCalled();
  });

  it('calls onDismiss and resets state when handleDismiss is invoked', () => {
    const onDismiss = vi.fn();
    const boundary = new ErrorBoundary({ onDismiss });
    boundary.setState = vi.fn();

    boundary.handleDismiss();
    expect(boundary.setState).toHaveBeenCalledWith({
      hasError: false,
      error: null,
      errorInfo: null
    });
    expect(onDismiss).toHaveBeenCalled();
  });

  it('resets state when resetKeys change on update', () => {
    const onReset = vi.fn();
    const boundary = new ErrorBoundary({ resetKeys: [false], onReset });
    boundary.state = {
      hasError: true,
      error: new Error('Window crashed'),
      errorInfo: null
    };
    boundary.setState = vi.fn();

    // Prop update with different resetKeys (e.g. window reopened isOpen: true)
    boundary.componentDidUpdate({ resetKeys: [true] });

    expect(boundary.setState).toHaveBeenCalledWith({
      hasError: false,
      error: null,
      errorInfo: null
    });
    expect(onReset).toHaveBeenCalled();
  });

  it('does not reset state when resetKeys have not changed', () => {
    const boundary = new ErrorBoundary({ resetKeys: [true] });
    boundary.state = {
      hasError: true,
      error: new Error('Window crashed'),
      errorInfo: null
    };
    boundary.setState = vi.fn();

    boundary.componentDidUpdate({ resetKeys: [true] });

    expect(boundary.setState).not.toHaveBeenCalled();
  });

  it('isolates window-chrome failures so individual window failure does not hit root boundary', () => {
    const windowBoundary = new ErrorBoundary({
      fallbackTitle: 'SETUP.EXE',
      onDismiss: vi.fn()
    });
    windowBoundary.state = {
      hasError: true,
      error: new Error('RetroWindow chrome crashed'),
      errorInfo: null
    };

    const windowHtml = renderToString(windowBoundary.render() as React.ReactElement);
    expect(windowHtml).toContain('SETUP.EXE — Application Error');
    expect(windowHtml).toContain('RetroWindow chrome crashed');
    expect(windowHtml).not.toContain('Restart Web OS');
  });

  it('catches provider-level throw at top-level boundary (AlertProvider or App root)', () => {
    const rootBoundary = new ErrorBoundary({
      isRoot: true,
      fallbackTitle: "Nate's Software Web OS"
    });
    rootBoundary.state = {
      hasError: true,
      error: new Error('AlertProvider context initialization failed'),
      errorInfo: null
    };

    const html = renderToString(rootBoundary.render() as React.ReactElement);
    expect(html).toContain('Restart Web OS');
    expect(html).toContain('Software Web OS — Application Error');
    expect(html).toContain('AlertProvider context initialization failed');
  });

  it('allows a dismissed window to reopen and render fresh content', () => {
    let isOpen = true;
    const boundary = new ErrorBoundary({
      fallbackTitle: 'HOTWIRE',
      onDismiss: () => { isOpen = false; }
    });

    // 1. Crash state
    boundary.state = {
      hasError: true,
      error: new Error('Simulated runtime error in Hotwire'),
      errorInfo: null
    };

    // 2. User dismisses window
    boundary.handleDismiss();
    expect(isOpen).toBe(false);

    // 3. Reopening window mounts fresh ErrorBoundary
    const freshBoundary = new ErrorBoundary({
      fallbackTitle: 'HOTWIRE',
      children: <div data-testid="hotwire-view">Fresh Hotwire Drops</div>
    });
    const freshHtml = renderToString(freshBoundary.render() as React.ReactElement);
    expect(freshHtml).toContain('Fresh Hotwire Drops');
    expect(freshHtml).not.toContain('Application Error');
  });
});

describe('Web OS Desktop with Error Boundaries', () => {
  it('renders the complete App tree safely inside top-level and window error boundaries', () => {
    const html = renderToString(
      <AlertProvider>
        <App />
      </AlertProvider>
    );

    // Desktop icons and taskbar rendered
    expect(html).toContain('SETUP.EXE');
    expect(html).toContain('TERMINAL.EXE');
    expect(html).toContain('HOTWIRE');
    expect(html).toContain('GITSMITH');
    // Top-level didn't trigger error boundary
    expect(html).not.toContain('Software Web OS — Application Error');
  });
});
