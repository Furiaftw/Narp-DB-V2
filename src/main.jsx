import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';
import UpdateBanner from './components/ui/UpdateBanner.jsx';
import { initPWAUpdate } from './pwaUpdate.js';
import './index.css';

// Register the service worker so push notifications can be delivered even when
// the site is closed, and so a new deploy can be surfaced via UpdateBanner
// instead of a tab silently running a stale build indefinitely.
initPWAUpdate();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
      <UpdateBanner />
    </ErrorBoundary>
  </StrictMode>
);
