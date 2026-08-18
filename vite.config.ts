import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5176, open: true },
  build: {
    target: 'es2020',
    // The whole game is small enough that a single file beats a waterfall.
    assetsInlineLimit: 0,
  },
});
