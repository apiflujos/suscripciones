const fs = require('fs');
const path = require('path');

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

applyEnvFile(adminEnvFile);

const stackName = process.env.PM2_APP_PREFIX || process.env.APP_STACK_NAME || 'crm-sus';
const clientSlug = process.env.CLIENT_SLUG || '';
const enableAdmin = process.env.PM2_ENABLE_ADMIN === '1' || process.env.PM2_ENABLE_ADMIN === 'true';

const nameFor = (role) => (clientSlug ? `${stackName}-${role}-${clientSlug}` : `${stackName}-${role}`);
const logBaseFor = (role) => (clientSlug ? `${stackName}-${role}-${clientSlug}` : role);

const apps = [
  {
    name: nameFor('jobs'),
    cwd: './apps/worker',
    script: 'npm',
    args: 'run start',
    env_file: adminEnvFile,
    env: {
      NODE_ENV: 'production',
      JOBS_HEARTBEAT_KEY: process.env.JOBS_HEARTBEAT_KEY || nameFor('jobs'),
    },
    error_file: `../../logs/${logBaseFor('jobs')}-error.log`,
    out_file: `../../logs/${logBaseFor('jobs')}-out.log`,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    autorestart: true,
    watch: false,
    max_memory_restart: '300M'
  },
];

if (enableAdmin) {
  apps.push({
    name: nameFor('admin'),
    cwd: './apps/admin',
    script: 'npm',
    args: 'run start',
    env_file: adminEnvFile,
    env: {
      NODE_ENV: 'production',
    },
    error_file: `../../logs/${logBaseFor('admin')}-error.log`,
    out_file: `../../logs/${logBaseFor('admin')}-out.log`,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    autorestart: true,
    watch: false,
    max_memory_restart: '400M'
  });
}

module.exports = { apps };
