import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const DEFAULT_CONNECT = [
  'https://*.publicnode.com',
  'https://mempool.space',
  'https://li.quest',
  'https://api.coingecko.com',
];

/**
 * Injects a strict Content-Security-Policy into production builds only
 * (the dev server needs inline scripts for hot reload). connect-src is
 * limited to the default endpoints plus any VITE_RPC_* / VITE_BTC_API overrides.
 */
const csp = (env: Record<string, string>): Plugin => ({
  name: 'pqw-csp',
  apply: 'build',
  transformIndexHtml(html) {
    const extra = Object.entries(env)
      .filter(([k, v]) => /^VITE_(RPC_|BTC_API)/.test(k) && v.startsWith('https://'))
      .map(([, v]) => new URL(v).origin);
    const connect = [...new Set(["'self'", ...DEFAULT_CONNECT, ...extra])].join(' ');
    const policy = [
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      `connect-src ${connect}`,
      "manifest-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "object-src 'none'",
    ].join('; ');
    return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
  },
});

export default defineConfig(({ mode }) => ({
  plugins: [react(), csp(loadEnv(mode, '.', 'VITE_'))],
  build: {
    target: 'es2022',
    sourcemap: false,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 900,
  },
  server: { port: 5173, strictPort: true },
}));
