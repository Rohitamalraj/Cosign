/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The API routes import the agents package from ../agents (TypeScript, outside this folder).
  experimental: { externalDir: true },
};
export default nextConfig;
