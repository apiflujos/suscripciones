module.exports = {
  apps: [
    {
      name: 'wompi-subs-api',
      cwd: './apps/api',
      script: 'npm',
      args: 'run start:migrate',
      env_file: './apps/api/.env',
      env: {
        NODE_ENV: 'production',
      },
      error_file: '../../logs/api-error.log',
      out_file: '../../logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M'
    },
    {
      name: 'wompi-subs-jobs',
      cwd: './apps/api',
      script: 'npm',
      args: 'run jobs:start',
      env_file: './apps/api/.env',
      env: {
        NODE_ENV: 'production',
      },
      error_file: '../../logs/jobs-error.log',
      out_file: '../../logs/jobs-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      autorestart: true,
      watch: false,
      max_memory_restart: '300M'
    },
  ]
};
