import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/client',
  build: { outDir: '../../dist/client' },
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
});
