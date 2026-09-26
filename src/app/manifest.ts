import type { MetadataRoute } from 'next';

/**
 * PWA manifest. Icons are generated from the existing SEAMS AI asset
 * (`public/seams_ai_ico.png`) at 192/512 plus a maskable variant on the brand
 * blue, which is what installability checks require.
 *
 * No service worker is registered: there is deliberately no generic HTTP cache
 * so that examination payloads, answer keys and result data are never written
 * to a shared cache. Exam answers persist only in the IndexedDB store owned by
 * `src/lib/sync.ts`.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'SEAMS AI — AI-Assisted Secure Assessment',
    short_name: 'SEAMS AI',
    description: 'AI-Assisted Secure Examination and Assessment Management System',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f8fafc',
    theme_color: '#2563eb',
    lang: 'en',
    categories: ['education'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      { src: '/seams_ai_ico.png', sizes: 'any', type: 'image/png' },
    ],
  };
}
