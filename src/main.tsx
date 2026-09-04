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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary isRoot fallbackTitle="Nate's Software Web OS">
      <AlertProvider>
        <App />
      </AlertProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
