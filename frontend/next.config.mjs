/** @type {import('next').NextConfig} */
const nextConfig = {
  // A second instance (for example a clean demo run) can use its own build folder beside the main one.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  experimental: {
    // The API routes import the agents package from ../agents (TypeScript, outside this folder).
    externalDir: true,
    // pdf.js loads its own worker at runtime, which a bundler would break. Let Node load it.
    serverComponentsExternalPackages: ['pdfjs-dist', '@electric-sql/pglite', 'pg', 'tesseract.js', '@napi-rs/canvas'],
  },
};
export default nextConfig;