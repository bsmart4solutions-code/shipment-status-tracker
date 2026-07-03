/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  async rewrites() {
    // Proxy /api/* to the NestJS backend so the browser talks to one origin.
    const api = process.env.API_URL || 'http://localhost:4000';
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
  },
};
export default nextConfig;
