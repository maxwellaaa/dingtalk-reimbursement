/**
 * 清理 user_role 重复行（MySQL UNIQUE 对 NULL project_id 允许多条）
 * 用法: node scripts/migrate-dedupe-user-roles.js
 */
import { closePool, query } from '../src/db/pool.js';
import { dedupeUserRoles } from '../src/services/roleAdmin.js';

async function main() {
  const users = await query(
    `SELECT DISTINCT user_id AS userId FROM user_role WHERE status = 1`,
  );
  let totalRemoved = 0;
  for (const row of users) {
    const { removed } = await dedupeUserRoles(row.userId);
    totalRemoved += removed;
  }
  console.log(`[ok] deduped ${users.length} user(s), removed ${totalRemoved} duplicate role row(s)`);
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
