import { defineConfig } from 'vite';

export default defineConfig({
  base: '/birthday-counter/',
  build: {
    target: 'es2020',
    cssCodeSplit: false,
    sourcemap: false
  }
});
