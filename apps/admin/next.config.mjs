import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDockerBuild = process.env.DOCKER_BUILD === "1";

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(isDockerBuild ? { output: "standalone", outputFileTracingRoot: path.join(__dirname, "../../") } : {}),
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
