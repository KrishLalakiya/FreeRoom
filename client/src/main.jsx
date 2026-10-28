import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Global minimal auto-hiding scrollbar detector
let scrollTimer = null;
window.addEventListener(
  'scroll',
  (e) => {
    document.body.setAttribute('data-scrolling', 'true');
    const target = e.target === document ? document.documentElement : e.target;
    if (target && target.setAttribute) {
      target.setAttribute('data-scrolling', 'true');
    }
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      document.body.removeAttribute('data-scrolling');
      if (target && target.removeAttribute) {
        target.removeAttribute('data-scrolling');
      }
    }, 800);
  },
  { passive: true, capture: true }
);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
