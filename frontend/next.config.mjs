/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // API proxy is now handled by src/app/api/[...path]/route.ts (API route handler)
  // which is more reliable than rewrites in dev mode
};
export default nextConfig;
