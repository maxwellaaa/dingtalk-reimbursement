/**
 * 生产初始化：同步 env → sys_config，不写入 dev_user / 测试项目。
 * 用户账号由钉钉免登首次访问时自动 upsert。
 */
import { query } from '../src/db/pool.js';

async function main() {
  const processCode = process.env.DINGTALK_PROCESS_CODE || '';
  if (processCode) {
    await query(
      `UPDATE sys_config SET config_value = :value, updated_at = NOW() WHERE config_key = 'dingtalk.process_code'`,
      { value: processCode },
    );
    console.log('[db:seed-prod] dingtalk.process_code synced from env');
  } else {
    console.warn('[db:seed-prod] DINGTALK_PROCESS_CODE empty — 方案 B 需配置 OA 模板 processCode');
  }

  const mode = process.env.APPROVAL_MODE || 'B';
  await query(`UPDATE sys_config SET config_value = :mode WHERE config_key = 'approval.mode'`, { mode });
  console.log('[db:seed-prod] approval.mode =', mode);

  console.log('[db:seed-prod] 生产环境不创建 dev_user。请通过钉钉登录，并在库中维护 project / project_budget / approval_flow。');
  console.log('[db:seed-prod] 参考 docs/管理员手册.md § 首次部署与业务配置');
}

main().catch((err) => {
  console.error('[db:seed-prod] failed:', err.message);
  process.exit(1);
});
