import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.jsx';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';
import './index.css';

// Register the service worker so push notifications can be delivered even when
// the site is closed. `immediate` ensures navigator.serviceWorker.ready resolves
// promptly so subscribeToPush() has a live registration to work with.
registerSW({ immediate: true });

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
