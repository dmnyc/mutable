/** @type {import('next').NextConfig} */
const nextConfig = {
  // The Draftable card route reads these from disk to draw pack previews.
  outputFileTracingIncludes: {
    '/draftable/card': [
      './public/draftable_camo.svg',
      './public/mutable_logo.svg',
      './public/mutable_text.svg',
    ],
  },
  async redirects() {
    return [
      {
        source: '/muteoscope',
        destination: '/mute-o-scope',
        permanent: true,
      },
      {
        source: '/backups',
        destination: '/dashboard?tab=backups',
        permanent: false,
      },
    ]
  },
}

export default nextConfig
