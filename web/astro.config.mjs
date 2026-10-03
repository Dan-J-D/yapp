// @ts-check
import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';

// PWA: manifest + service worker are hand-written in public/ (manifest.webmanifest, sw.js).
// @vite-pwa/astro only supports Astro <= 5, and the app needs very little from it.
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [svelte()],
  vite: { plugins: [tailwindcss()] },
  server: { host: true },
  security: { checkOrigin: true },
});
