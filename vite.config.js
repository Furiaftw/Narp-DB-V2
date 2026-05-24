import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const define = {};
if (!process.env.VITE_SUPABASE_URL && process.env.SUPABASE_DATABASE_URL) {
  define['import.meta.env.VITE_SUPABASE_URL'] = JSON.stringify(process.env.SUPABASE_DATABASE_URL);
}
if (!process.env.VITE_SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY) {
  define['import.meta.env.VITE_SUPABASE_ANON_KEY'] = JSON.stringify(process.env.SUPABASE_ANON_KEY);
}

export default defineConfig({
  plugins: [react()],
  define,
});
