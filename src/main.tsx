import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/atelier.css';
import { App } from './ui/App';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root mount container #root not found in index.html');
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
