/**
 * 为 project_member 补充 source / joined_at（幂等）
 */
import { closePool, query } from '../src/db/pool.js';

async function columnExists(table, column) {
  const rows = await query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND COLUMN_NAME = :column`,
    { table, column },
  );
  return Number(rows[0]?.c) > 0;
}

async function main() {
  if (!(await columnExists('project_member', 'source'))) {
    await query(
      `ALTER TABLE project_member
       ADD COLUMN source VARCHAR(16) NOT NULL DEFAULT 'admin' COMMENT 'self|admin' AFTER role`,
    );
    console.log('[ok] added project_member.source');
  } else {
    console.log('[skip] project_member.source exists');
  }

  if (!(await columnExists('project_member', 'joined_at'))) {
    await query(
      `ALTER TABLE project_member
       ADD COLUMN joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER source`,
    );
    console.log('[ok] added project_member.joined_at');
  } else {
    console.log('[skip] project_member.joined_at exists');
  }

  console.log('migrate-project-member: done');
}

main()
  .catch((err) => {
    console.error('migrate-project-member FAILED:', err.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
