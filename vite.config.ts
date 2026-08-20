import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      // injectManifest rather than the generated worker: Papertrail needs its
      // own notificationclick and periodicsync handlers, which a generated
      // worker has no way to carry. The precache behaviour is unchanged — src/sw.ts
      // calls precacheAndRoute on the same injected manifest.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
      manifest: {
        name: 'Papertrail',
        short_name: 'Papertrail',
        description: 'A local-first evidence log. Everything stays on your device.',
        theme_color: '#0e1116',
        background_color: '#0e1116',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  build: {
    // Phones stay on old browser versions far longer than desktops, and a
    // syntax error means a blank page rather than a degraded one.
    target: ['es2020', 'safari14', 'chrome87', 'firefox78'],
  },
})
