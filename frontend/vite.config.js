import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Vite does not read PORT on its own. Honouring it here lets a launcher
    // assign a free port instead of failing when 5173 is already taken.
    port: Number(process.env.PORT) || 5173,
    // Proxying /api keeps the browser on one origin, so the dev server needs no
    // CORS negotiation with the backend and lib/api.js needs no base URL. The
    // backend still ships a CORS allow-list for the cross-origin case; this is
    // simply the path that cannot get it wrong.
    proxy: {
      '/api': {
        target: process.env.BACKEND_URL || 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
});
