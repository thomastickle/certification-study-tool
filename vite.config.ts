import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/web',
  base: '/',
  server: {
    fs: {
      allow: [resolve('src/web'), resolve('src/shared'), resolve('node_modules')],
      deny: ['**/private/**', '**/.git/**', '**/.env*', '**/*.db', '**/*.db-*', '**/*.sqlite*'],
    },
  },
  build: { outDir: '../../dist', emptyOutDir: true },
});
