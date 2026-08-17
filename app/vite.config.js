import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  root: 'app/client',
  base: '/app/',
  build: {
    outDir: '../public/assets',
    emptyOutDir: true,
    manifest: false,
    rollupOptions: {
      input: path.resolve('app/client/main.tsx'),
      output: { entryFileNames: 'main.js', chunkFileNames: 'chunks/[name]-[hash].js', assetFileNames: 'assets/[name]-[hash][extname]' },
    },
  },
});
