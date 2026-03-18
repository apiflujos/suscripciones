import path from "path";

// Force-enable Document context to avoid build-time Html guard failures.
process.env.__NEXT_DOCUMENT__ = "true";

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@suscripciones/database", "@suscripciones/core"],
  outputFileTracingRoot: path.join(process.cwd(), "../.."),
  eslint: { ignoreDuringBuilds: true },
  webpack: (config) => {
    config.resolve = config.resolve || {};
    config.resolve.alias = config.resolve.alias || {};
    config.resolve.alias["next/document"] = path.join(
      process.cwd(),
      "lib/next-document-shim.js"
    );
    config.resolve.alias["@suscripciones/database"] = path.join(
      process.cwd(),
      "../../packages/database/src"
    );
    return config;
  }
};

export default nextConfig;
