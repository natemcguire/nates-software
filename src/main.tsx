if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

import { AlertProvider } from './context/AlertContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

declare global {
  interface Window {
    __NSW_BOOT_START__?: number;
  }
}

const BOOT_MIN_MS = 2000;

function mountApp() {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary isRoot fallbackTitle="Nate's Software Web OS">
        <AlertProvider>
          <App />
        </AlertProvider>
      </ErrorBoundary>
    </React.StrictMode>
  );
}

const bootStart = typeof window !== 'undefined' && window.__NSW_BOOT_START__
  ? window.__NSW_BOOT_START__
  : Date.now();
const bootElapsed = Date.now() - bootStart;

if (bootElapsed >= BOOT_MIN_MS) {
  mountApp();
} else {
  window.setTimeout(mountApp, BOOT_MIN_MS - bootElapsed);
}
