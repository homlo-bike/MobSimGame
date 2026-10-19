import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { setLocale } from './i18n';
import { createLogger, currentLogLevel } from './util/logger';

setLocale('en');

createLogger('app').info('MobSimGame started', {
  mode: import.meta.env.MODE,
  logLevel: currentLogLevel(),
  backend: import.meta.env.VITE_API_BASE_URL || 'same origin',
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
