/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
      allowedOrigins: ['localhost:3000']
    }
  },
  env: {
    DATABASE_URL: process.env.DATABASE_URL,
    ADMIN_API_TOKEN: process.env.ADMIN_API_TOKEN,
    ADMIN_SESSION_SECRET: process.env.ADMIN_SESSION_SECRET,
    CREDENTIALS_ENCRYPTION_KEY_B64: process.env.CREDENTIALS_ENCRYPTION_KEY_B64,
    WOMPI_ACTIVE_ENV: process.env.WOMPI_ACTIVE_ENV,
    CHATWOOT_ACTIVE_ENV: process.env.CHATWOOT_ACTIVE_ENV,
    JOBS_HEARTBEAT_KEY: process.env.JOBS_HEARTBEAT_KEY,
    GAMIFICATION_RECALC_MINUTES: process.env.GAMIFICATION_RECALC_MINUTES
  },
  transpilePackages: ['@wompi/database']
};

export default nextConfig;
