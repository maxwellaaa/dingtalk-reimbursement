import mysql from 'mysql2/promise';
import { config } from '../config.js';

/** @type {mysql.Pool | null} */
let pool = null;

export function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      waitForConnections: true,
      connectionLimit: 10,
      namedPlaceholders: true,
      timezone: '+08:00',
    });
  }
  return pool;
}

export async function query(sql, params) {
  const [rows] = await getPool().query(sql, params);
  return rows;
}

export async function withTransaction(fn) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function pingDb() {
  await query('SELECT 1 AS ok');
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
