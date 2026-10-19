'use strict';
const { createApp } = require('./app');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';

createApp().listen(PORT, HOST, () => {
  console.log(`[pidash] display: http://localhost:${PORT}/   admin: http://localhost:${PORT}/admin/`);
});

process.on('unhandledRejection', (e) => console.error('[pidash] unhandled rejection:', e));
