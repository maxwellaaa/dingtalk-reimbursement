import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import { config } from '../src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const schemaPath = path.resolve(__dirname, '../../database/schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    multipleStatements: true,
  });

  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${config.db.database}\` DEFAULT CHARACTER SET utf8mb4`);
  await conn.query(`USE \`${config.db.database}\``);
  await conn.query(sql);
  await conn.end();

  console.log('[db:init] schema applied to', config.db.database);
}

main().catch((err) => {
  console.error('[db:init] failed:', err.message);
  process.exit(1);
});
