import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import { applyTheme, getSavedTheme } from './lib/theme';
import './index.css';

// The theme lives on <html>, outside React: apply the saved choice before
// the first paint so every route renders themed and there is no flash.
applyTheme(getSavedTheme());

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Missing #root element');

createRoot(rootEl).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
