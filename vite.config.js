import { defineConfig } from 'vite';
import { workpathServiceWorkerPlugin } from './scripts/pwa-plugin.js';

export default defineConfig({
  base: './',
  plugins: [workpathServiceWorkerPlugin()]
});
