import cors from 'cors';

import express from 'express';

import { assertDingTalkConfig, config } from './config.js';

import { pingDb } from './db/pool.js';

import { ensureUploadDir } from './services/attachment.js';

import authRoutes from './routes/auth.js';

import healthRoutes from './routes/health.js';

import metaRoutes from './routes/meta.js';

import reimbursementRoutes from './routes/reimbursements.js';
import approvalRoutes from './routes/approvals.js';
import webhookRoutes from './routes/webhooks.js';
import configRoutes from './routes/config.js';
import adminRoutes from './routes/admin.js';
import projectMemberRoutes from './routes/projectMembers.js';
import { startDingTalkStream } from './services/dingtalkStream.js';
import { syncProcessCodeFromEnv } from './services/sysConfig.js';



assertDingTalkConfig();

ensureUploadDir();

const app = express();

const LOCAL_ORIGINS = new Set([
  config.frontendUrl,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

function isTunnelOrigin(origin) {
  try {
    const host = new URL(origin).hostname;
    return /\.(cpolar\.(cn|com|top)|ngrok-free\.app|ngrok\.io|natappfree\.cc|loca\.lt)$/i.test(host);
  } catch {
    return false;
  }
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || LOCAL_ORIGINS.has(origin) || isTunnelOrigin(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
  }),
);

app.use(express.json({ limit: '2mb' }));



app.use('/api', healthRoutes);

app.use('/api/auth', authRoutes);

app.use('/api', metaRoutes);

app.use('/api/reimbursements', reimbursementRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/config', configRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', projectMemberRoutes);

app.use((_req, res) => {

  res.status(404).json({ code: 404, message: 'Not Found' });

});



app.use((err, _req, res, _next) => {

  console.error('[error]', err);

  if (err.code === 'LIMIT_FILE_SIZE') {

    return res.status(400).json({ code: 400, message: `文件不能超过 ${config.upload.maxSizeMb}MB` });

  }

  res.status(500).json({ code: 500, message: err.message || 'Internal Server Error' });

});



async function start() {

  try {

    await pingDb();

    console.log('[backend] MySQL connected');

    await syncProcessCodeFromEnv();

  } catch (err) {

    console.error('[backend] MySQL unavailable:', err.message);

    console.error('[backend] Run: npm run db:init && npm run db:seed');

  }



  app.listen(config.port, () => {

    console.log(`[backend] P5 running at http://localhost:${config.port}`);
    console.log(`[backend] frontend URL: ${config.frontendUrl}`);
  });

  startDingTalkStream();

}



start();

