const fs = require('fs');
const path = require('path');

const rootEnvFile = './.env';
const adminEnvFile = './apps/admin/.env.local';

const applyEnvFile = (filePath) => {
  const fullPath = path.resolve(__dirname, filePath);
  if (!fs.existsSync(fullPath)) return;
  const content = fs.readFileSync(fullPath, 'utf8');
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) return;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (!key) return;
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  });
};

applyEnvFile(rootEnvFile);
applyEnvFile(adminEnvFile);

const stackName = process.env.PM2_APP_PREFIX || process.env.APP_STACK_NAME || 'crm-sus';
const clientSlug = process.env.CLIENT_SLUG || '';
const enableAdmin = true;
const enableApi = true;

const nameFor = (role) => (clientSlug ? `${stackName}-${role}-${clientSlug}` : `${stackName}-${role}`);
const apps = [
  {
    name: nameFor('jobs'),
    cwd: './apps/worker',
    script: 'npm',
    args: 'run start',
    env_file: rootEnvFile,
    env: {
      NODE_ENV: 'production',
      JOBS_HEARTBEAT_KEY: process.env.JOBS_HEARTBEAT_KEY || nameFor('jobs'),
      DATABASE_URL: process.env.DATABASE_URL,
      JWT_SECRET: process.env.JWT_SECRET,
      JWT_ISSUER: process.env.JWT_ISSUER,
      JWT_AUDIENCE: process.env.JWT_AUDIENCE,
      CREDENTIALS_ENCRYPTION_KEY_B64: process.env.CREDENTIALS_ENCRYPTION_KEY_B64,
      REALTIME_PUBLISH_URL: process.env.REALTIME_PUBLISH_URL,
      REALTIME_PUBLISH_TOKEN: process.env.REALTIME_PUBLISH_TOKEN,
    },
    error_file: "/dev/stderr",
    out_file: "/dev/stdout",
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    autorestart: true,
    watch: false,
    max_memory_restart: '300M'
  },
];

if (enableApi) {
  apps.push({
    name: nameFor('api'),
    cwd: './apps/api',
    script: 'npm',
    args: 'run start',
    env_file: rootEnvFile,
    env: {
      NODE_ENV: 'production',
      PORT: process.env.API_PORT || 3001,
      HOST: process.env.HOST || '0.0.0.0',
      DATABASE_URL: process.env.DATABASE_URL,
      JWT_SECRET: process.env.JWT_SECRET,
      JWT_ISSUER: process.env.JWT_ISSUER,
      JWT_AUDIENCE: process.env.JWT_AUDIENCE,
      CREDENTIALS_ENCRYPTION_KEY_B64: process.env.CREDENTIALS_ENCRYPTION_KEY_B64,
      WOMPI_PRIVATE_KEY: process.env.WOMPI_PRIVATE_KEY,
      WOMPI_PUBLIC_KEY: process.env.WOMPI_PUBLIC_KEY,
      WOMPI_INTEGRITY_SECRET: process.env.WOMPI_INTEGRITY_SECRET,
      CHATWOOT_ACCESS_TOKEN: process.env.CHATWOOT_ACCESS_TOKEN,
      CHATWOOT_INBOX_ID: process.env.CHATWOOT_INBOX_ID,
      CHATWOOT_API_URL: process.env.CHATWOOT_API_URL,
    },
    error_file: "/dev/stderr",
    out_file: "/dev/stdout",
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    autorestart: true,
    watch: false,
    max_memory_restart: '500M'
  });
}

if (enableAdmin) {
  apps.push({
    name: nameFor('admin'),
    cwd: './apps/admin',
    script: 'npm',
    args: 'run start',
    env_file: rootEnvFile,
    env: {
      NODE_ENV: 'production',
      PORT: process.env.PORT || 3002,
      HOST: process.env.HOST || '0.0.0.0',
      DATABASE_URL: process.env.DATABASE_URL,
      JWT_SECRET: process.env.JWT_SECRET,
      JWT_ISSUER: process.env.JWT_ISSUER,
      JWT_AUDIENCE: process.env.JWT_AUDIENCE,
      ADMIN_SESSION_SECRET: process.env.ADMIN_SESSION_SECRET,
      CREDENTIALS_ENCRYPTION_KEY_B64: process.env.CREDENTIALS_ENCRYPTION_KEY_B64,
      REALTIME_PUBLISH_URL: process.env.REALTIME_PUBLISH_URL,
      REALTIME_PUBLISH_TOKEN: process.env.REALTIME_PUBLISH_TOKEN,
    },
    error_file: "/dev/stderr",
    out_file: "/dev/stdout",
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    autorestart: true,
    watch: false,
    max_memory_restart: '400M'
  });
}

module.exports = { apps };
