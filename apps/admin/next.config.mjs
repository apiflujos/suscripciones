import path from "path";

// Force-enable Document context to avoid build-time Html guard failures.
process.env.__NEXT_DOCUMENT__ = "true";

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: path.join(process.cwd(), "../.."),
  eslint: { ignoreDuringBuilds: true },
  webpack: (config) => {
    config.resolve = config.resolve || {};
    config.resolve.alias = config.resolve.alias || {};
    config.resolve.alias["next/document"] = path.join(
      process.cwd(),
      "lib/next-document-shim.js"
    );
    return config;
  }
};

export default nextConfig;
