// File: vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';

export default defineConfig(({ mode }) => ({
  base: '/',
  plugins: [
    react(),
    svgr({ svgrOptions: { icon: true } }),
  ],
  optimizeDeps: {
    esbuildOptions: {
      loader: {
        '.js': 'jsx',
        '.jsx': 'jsx',
      },
    },
  },
  esbuild: {
    loader: 'jsx',
    include: /src\/.*\.[jt]sx?$/, // explicitly include all js, jsx, ts, tsx in src
    jsx: 'automatic',
  },
  worker: {
    format: 'es', // Ensure workers are built as ES modules
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(mode),
    'process.env.PUBLIC_URL': JSON.stringify('/'),
  },
}));
