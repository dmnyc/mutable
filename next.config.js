/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      {
        source: '/muteoscope',
        destination: '/mute-o-scope',
        permanent: true,
      },
    ]
  },
}

module.exports = nextConfig
