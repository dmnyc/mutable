/** @type {import('next').NextConfig} */
const nextConfig = {
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
