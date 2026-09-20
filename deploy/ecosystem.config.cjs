/**
 * PM2 进程配置（非 Docker 部署）
 * 用法：cd backend && pm2 start ../deploy/ecosystem.config.cjs
 */
module.exports = {
  apps: [
    {
      name: 'reimb-backend',
      cwd: __dirname + '/../backend',
      script: 'src/index.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '512M',
      error_file: '../logs/backend-error.log',
      out_file: '../logs/backend-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
