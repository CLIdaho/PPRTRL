import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Builds Papertrail as one self-contained HTML file.
 *
 * Unlike the normal build, this one can be opened by double-clicking it, mailed
 * to someone, or dropped on a USB stick — an inline module script has nothing to
 * fetch, so the browser's file:// restrictions never come into play. No service
 * worker here: there is nothing to cache when the whole app is the page.
 */
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      // No PWA plugin here, so the virtual module it provides needs a stand-in.
      'virtual:pwa-register': new URL('./src/lib/no-service-worker.ts', import.meta.url).pathname,
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist-single',
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
})
