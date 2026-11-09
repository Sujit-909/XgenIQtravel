import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // node:sqlite and pdf-lib run on the server only
  serverExternalPackages: ['pdf-lib'],
};
// Keep production validation from replacing chunks used by a running dev server.
export default (phase) => ({
  ...nextConfig,
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next',
});
