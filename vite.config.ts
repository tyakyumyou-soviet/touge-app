import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/',
  server: {
    // Netlify production uses the function with the same path. In local Vite
    // development, proxy it to Overpass so range proposals are fully usable.
    proxy: {
      '/api/road-discovery': {
        target: 'https://overpass-api.de',
        changeOrigin: true,
        rewrite: (path) => path.replace('/api/road-discovery', '/api/interpreter'),
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage'],
          map: ['maplibre-gl'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg', 'icons/maskable.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png'],
      manifest: {
        name: '峠 — Touge Drive Explorer',
        short_name: '峠',
        id: '/',
        description: 'カーブ、高低差、道幅から走って楽しい峠道を探すドライブアプリ',
        lang: 'ja',
        theme_color: '#101915',
        background_color: '#f3f1e8',
        display: 'standalone',
        orientation: 'any',
        categories: ['navigation', 'travel'],
        scope: '/',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        // Workbox does not consume navigationPreload for this SPA fallback.
        // Leaving it enabled causes Chrome to emit cancelled-preload warnings
        // whenever a navigation is replaced by a new app navigation.
        navigationPreload: false,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/(tiles\.openfreemap\.org|demotiles\.maplibre\.org)\//,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'map-tiles',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 240, maxAgeSeconds: 60 * 60 * 24 * 7 }
            }
          },
          {
            urlPattern: /^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'terrain-tiles',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 7 }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'web-fonts',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 }
            }
          }
        ]
      }
    })
  ]
})
