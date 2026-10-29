/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // node:sqlite and pdf-lib run on the server only
  serverExternalPackages: ['pdf-lib'],
};
export default nextConfig;
