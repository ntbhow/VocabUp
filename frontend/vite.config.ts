import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

function isHttpsNgrokRequest(req: import('node:http').IncomingMessage): boolean {
  const forwardedProto = req.headers['x-forwarded-proto'];
  if (typeof forwardedProto !== 'string' || forwardedProto.split(',')[0]?.trim().toLowerCase() !== 'https') return false;
  try {
    const hostname = new URL(`http://${req.headers.host ?? ''}`).hostname.toLowerCase();
    return hostname.endsWith('.ngrok-free.app') || hostname.endsWith('.ngrok-free.dev');
  } catch {
    return false;
  }
}

function viteResponsePolicy() {
  const middleware = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: (error?: unknown) => void) => {
    if (isHttpsNgrokRequest(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    if (new URL(req.url ?? '/', 'http://localhost').pathname === '/sitemap.xml') {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-store');
      res.end('Not found');
      return;
    }
    next();
  };
  return {
    name: 'vocabup-proxy-response-policy',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server: import('vite').PreviewServer) {
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const apiOrigin = env.VITE_API_URL?.startsWith('http') ? new URL(env.VITE_API_URL).origin : "'self'";
  return {
  plugins: [react(), tailwindcss(), viteResponsePolicy(), {
    name: 'vocabup-production-csp',
    apply: 'build',
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ${apiOrigin}` }, injectTo: 'head' }];
    },
  }],
  server: {
    port: 5173,
    headers: { 'X-Content-Type-Options': 'nosniff' },
    // ngrok's free ephemeral URL changes each time its tunnel restarts.
    // A leading dot allows any subdomain under this ngrok domain.
    allowedHosts: ['.ngrok-free.app', 'moocher-structure-doorstop.ngrok-free.dev'],
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    headers: { 'X-Content-Type-Options': 'nosniff' },
  },
  };
});
