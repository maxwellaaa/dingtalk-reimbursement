/**
 * 项目成员操作审计表（幂等）
 * 用法: node scripts/migrate-project-member-audit.js
 */
import { closePool, query } from '../src/db/pool.js';

async function tableExists(name) {
  const rows = await query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = :name LIMIT 1`,
    { name },
  );
  return rows.length > 0;
}

async function main() {
  if (await tableExists('project_member_audit')) {
    console.log('[skip] project_member_audit exists');
    return;
  }
  await query(`
    CREATE TABLE project_member_audit (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      actor_user_id INT NOT NULL,
      target_user_id INT NULL,
      action VARCHAR(32) NOT NULL,
      detail JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_pma_project (project_id),
      KEY idx_pma_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目成员变更审计'
  `);
  console.log('[ok] created project_member_audit');
}

main()
  .then(async () => {
    await closePool();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    await closePool();
    process.exit(1);
  });
