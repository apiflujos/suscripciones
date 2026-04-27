import path from "path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@suscripciones/database", "@suscripciones/core"],
  eslint: { ignoreDuringBuilds: true },
  webpack: (config) => {
    config.resolve = config.resolve || {};
    config.resolve.alias = config.resolve.alias || {};
    config.resolve.alias["@suscripciones/database"] = path.join(
      process.cwd(),
      "../../packages/database/src"
    );
    return config;
  }
};

export default nextConfig;
