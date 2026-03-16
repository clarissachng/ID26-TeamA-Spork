import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: '/ID26-TeamA-Spork/',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
});
