import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import './styles.css';
import { App } from './ui/App';
import { WalletProvider } from './ui/state';

// Refuse to run inside a frame (clickjacking protection; CSP frame-ancestors
// is not honoured from a <meta> tag, so enforce it here too).
if (window.top !== window.self) {
  document.body.textContent = 'Post-Q Wallet cannot be embedded in another page.';
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <WalletProvider>
        <App />
      </WalletProvider>
    </StrictMode>,
  );
}
