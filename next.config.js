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

export default nextConfig
