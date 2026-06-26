import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const define = {};
if (!process.env.VITE_SUPABASE_URL && process.env.SUPABASE_DATABASE_URL) {
  define['import.meta.env.VITE_SUPABASE_URL'] = JSON.stringify(process.env.SUPABASE_DATABASE_URL);
}
if (!process.env.VITE_SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY) {
  define['import.meta.env.VITE_SUPABASE_ANON_KEY'] = JSON.stringify(process.env.SUPABASE_ANON_KEY);
}

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'NARP Database',
        short_name: 'NARP DB',
        description: 'Official Database for the NARP community.',
        theme_color: '#4F46E5',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },
    }),
  ],
  define,
});
