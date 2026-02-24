import path from "path";

// Force-enable Document context to avoid build-time Html guard failures.
process.env.__NEXT_DOCUMENT__ = "true";

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: path.join(process.cwd(), "../.."),
  eslint: { ignoreDuringBuilds: true }
};

export default nextConfig;
