import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cargamos el .env del root del monorepo antes de que Next arme su propia
// tabla de env vars. Next solo mira apps/admin/.env* por defecto, pero los
// secretos compartidos (DATABASE_URL, JWT_SECRET, WOMPI_*) viven en el root
// junto al worker y los scripts. Sin esto, un `next dev`/`next start` local
// arranca sin DATABASE_URL y Prisma tira "Environment variable not found".
//
// El orden importa: primero apps/admin/.env.local (para que sus overrides
// como DATABASE_URL=localhost:5433 se anoten como "ya definidos"), después
// el .env del root, que rellena lo que falte. Cualquier valor ya presente en
// process.env (shell, systemd, docker) siempre gana.
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
loadEnvFile(path.join(__dirname, ".env.local"));
loadEnvFile(path.join(__dirname, "../../.env"));

const isDockerBuild = process.env.DOCKER_BUILD === "1";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Fijamos la raíz del monorepo para que Next no la infiera del lockfile más
  // cercano: en Windows, un pnpm-lock.yaml en el home del usuario ganaba y
  // rompía la carga de binarios nativos (swc, sharp).
  outputFileTracingRoot: path.join(__dirname, "../../"),
  ...(isDockerBuild ? { output: "standalone" } : {}),
  transpilePackages: ["@suscripciones/database", "@suscripciones/core"],
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
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
