/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // The API routes import the agents package from ../agents (TypeScript, outside this folder).
    externalDir: true,
    // pdf.js loads its own worker at runtime, which a bundler would break. Let Node load it.
    serverComponentsExternalPackages: ['pdfjs-dist', '@electric-sql/pglite', 'pg'],
  },
};
export default nextConfig;