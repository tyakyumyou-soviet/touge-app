import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const LOCAL_OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]

function compactDiscoveryQuery(query: string) {
  const radiusMatch = query.match(/way\(around:(\d+),/)
  const originalRadius = Number(radiusMatch?.[1])
  if (!Number.isFinite(originalRadius) || originalRadius <= 4500) return query
  const compactRadius = Math.max(4500, Math.round(originalRadius * .58))
  return query
    .replace(/way\(around:\d+,/, `way(around:${compactRadius},`)
    .replace(/out tags geom \d+;/, 'out tags geom 28;')
    .replace('[timeout:20]', '[timeout:14]')
}

/** Keep local discovery behaviour aligned with the production Netlify relay. */
function localRoadDiscoveryRelay() {
  return {
    name: 'local-road-discovery-relay',
    configureServer(server: { middlewares: { use: (path: string, handler: (request: { url?: string }, response: { statusCode: number; setHeader: (name: string, value: string) => void; end: (body: string) => void }) => Promise<void>) => void } }) {
      server.middlewares.use('/api/road-discovery', async (request, response) => {
        const query = new URL(request.url ?? '/', 'http://localhost').searchParams.get('data')
        if (!query || query.length > 3000 || !query.includes('[out:json]') || !query.includes('way(around:')) {
          response.statusCode = 400
          response.setHeader('content-type', 'application/json; charset=utf-8')
          response.end(JSON.stringify({ error: '道路探索クエリが不正です' }))
          return
        }
        const requestUpstream = async (endpoint: string, requestQuery: string) => {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), 18_000)
          try {
            const upstream = await fetch(endpoint, {
              method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
              body: new URLSearchParams({ data: requestQuery }), signal: controller.signal,
            })
            if (!upstream.ok) throw new Error(`Overpass API ${upstream.status}`)
            const body = await upstream.text()
            const parsed = JSON.parse(body) as { elements?: unknown[] }
            if (!Array.isArray(parsed.elements)) throw new Error('Overpass APIの応答形式が不正です')
            return body
          } finally { clearTimeout(timer) }
        }
        const compactQuery = compactDiscoveryQuery(query)
        const attempts = [
          ...LOCAL_OVERPASS_ENDPOINTS.map((endpoint) => requestUpstream(endpoint, query)),
          ...(compactQuery === query ? [] : [requestUpstream(LOCAL_OVERPASS_ENDPOINTS[0], compactQuery)]),
        ]
        try {
          const body = await Promise.any(attempts)
          response.statusCode = 200
          response.setHeader('content-type', 'application/json; charset=utf-8')
          response.end(body)
        } catch (error) {
          const failures = error instanceof AggregateError ? error.errors : [error]
          const last = failures.at(-1)
          const lastError = last instanceof Error ? last.message : '道路データを取得できませんでした'
          response.statusCode = 503
          response.setHeader('content-type', 'application/json; charset=utf-8')
          response.end(JSON.stringify({ error: lastError }))
        }
      })
    },
  }
}

export default defineConfig({
  base: '/',
  server: {
    proxy: {
      // Development-only equivalent of the constrained Netlify relay. The
      // browser sends the same WFS request that production validates.
      '/api/jartic-traffic': {
        target: 'https://api.jartic-open-traffic.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/jartic-traffic/, '/geoserver'),
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
    localRoadDiscoveryRelay(),
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
            urlPattern: /^https:\/\/tiles\.openfreemap\.org\//,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'map-tiles',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 240, maxAgeSeconds: 60 * 60 * 24 * 7 }
            }
          },
          {
            urlPattern: /^https:\/\/elevation-tiles-prod\.s3\.amazonaws\.com\/terrarium\//,
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
