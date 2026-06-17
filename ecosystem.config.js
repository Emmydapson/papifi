module.exports = {
  apps: [
    {
      name: 'papafi-backend',
      script: 'dist/index.js',
      instances: process.env.WEB_CONCURRENCY || 1,
      exec_mode: process.env.WEB_CONCURRENCY ? 'cluster' : 'fork',
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '512M',
      time: true,
    },
  ],
};
