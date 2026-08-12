/** Web app manifest JSON for the local CLI dashboard PWA. */
export const PWA_MANIFEST = JSON.stringify({
  name: 'Transcodes CLI Dashboard',
  short_name: 'Transcodes',
  description:
    'Local Transcodes CLI dashboard — profile, guide, and permissions.',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#f4f4f6',
  theme_color: '#16161a',
  icons: [
    {
      src: '/icon-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: '/icon-512.png',
      sizes: '192x192',
      type: 'image/png',
      purpose: 'any',
    },
  ],
});
