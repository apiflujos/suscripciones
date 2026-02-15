import path from "path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(process.cwd(), "../.."),
  eslint: { ignoreDuringBuilds: true }
};

export default nextConfig;
