/**
 * 写入园林工程科目 + 为示范项目补齐科目预算
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { LANDSCAPE_COST_CATEGORIES } from '../src/constants/landscapeFinance.js';

dotenv.config({ path: '.env' });

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  namedPlaceholders: true,
});

for (const cat of LANDSCAPE_COST_CATEGORIES) {
  await conn.query(
    `INSERT INTO cost_category (code, name, sort_order, status)
     VALUES (:code, :name, :sortOrder, 1)
     ON DUPLICATE KEY UPDATE name = VALUES(name), sort_order = VALUES(sort_order), status = 1`,
    { code: cat.code, name: cat.name, sortOrder: cat.sortOrder },
  );
  console.log('[ok] category', cat.code, cat.name);
}

const year = new Date().getFullYear();
const [projects] = await conn.query(`SELECT id, code FROM project WHERE status = 'active'`);
const [categories] = await conn.query(`SELECT id, code FROM cost_category WHERE status = 1`);

const amountByCode = Object.fromEntries(
  LANDSCAPE_COST_CATEGORIES.map((c) => [c.code, c.defaultBudget]),
);

for (const project of projects) {
  for (const cat of categories) {
    if (!amountByCode[cat.code]) continue; // 仅给新增园林科目补预算；老科目保持原值
    await conn.query(
      `INSERT INTO project_budget (project_id, cost_category_id, budget_amount, fiscal_year, status)
       VALUES (?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE budget_amount = VALUES(budget_amount), status = 1`,
      [project.id, cat.id, amountByCode[cat.code], year],
    );
  }
  console.log('[ok] budgets upserted for', project.code);
}

await conn.end();
console.log('[migrate-landscape-categories] done');
