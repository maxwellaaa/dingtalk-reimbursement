import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { Router } from 'express';
import { pingDb } from '../db/pool.js';

const router = Router();

const __dirname = dirname(fileURLToPath(import.meta.url));
let appVersion = '1.0.0';
try {
  const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));
  if (pkg.version) appVersion = pkg.version;
} catch {
  /* keep default */
}

router.get('/health', async (_req, res) => {
  let db = false;
  try {
    await pingDb();
    db = true;
  } catch {
    db = false;
  }
  res.json({
    ok: true,
    service: 'dingtalk-reimburse-backend',
    version: appVersion,
    phase: 'P5',
    db,
  });
});

export default router;
