import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import ErrorBoundary from './components/ErrorBoundary';
import { applySkin, applyTheme, getSavedSkin, getSavedTheme } from './lib/theme';
import './index.css';

// The theme and skin live on <html>, outside React: apply the saved choices
// before the first paint so every route renders themed and there is no flash.
applyTheme(getSavedTheme());
applySkin(getSavedSkin());

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Missing #root element');

createRoot(rootEl).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
