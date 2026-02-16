/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['plaid', 'better-sqlite3'],
  },
};

export default nextConfig;
