import { query, closePool } from '../src/db/pool.js';
import { ensureDevUser, upsertUserFromDingTalk } from '../src/services/user.js';
import { LANDSCAPE_COST_CATEGORIES } from '../src/constants/landscapeFinance.js';

async function ensureUserRoleTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS user_role (
      id              BIGINT PRIMARY KEY AUTO_INCREMENT,
      user_id         BIGINT       NOT NULL,
      role_code       VARCHAR(32)  NOT NULL COMMENT 'employee|project_manager|finance|gm',
      grade           CHAR(1)      NULL COMMENT 'A|B|C',
      region_id       BIGINT       NULL COMMENT '财务B：片区范围',
      project_id      BIGINT       NULL COMMENT '财务A/项目经理：项目范围',
      status          TINYINT      NOT NULL DEFAULT 1,
      created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_user_role_scope (user_id, role_code, grade, region_id, project_id),
      KEY idx_role_grade (role_code, grade),
      KEY idx_user (user_id)
    ) COMMENT='用户审批角色与可见范围'
  `);
}

async function ensureApprovalFlow() {
  await query(
    `INSERT INTO approval_flow (code, name, status)
     VALUES (:code, :name, 1)
     ON DUPLICATE KEY UPDATE name = VALUES(name), status = 1`,
    { code: 'DEFAULT', name: '默认报销审批流' },
  );

  const flows = await query('SELECT id FROM approval_flow WHERE code = :code LIMIT 1', {
    code: 'DEFAULT',
  });
  const flowId = flows[0].id;

  await query('DELETE FROM approval_flow_node WHERE flow_id = :flowId', { flowId });

  await query(
    `INSERT INTO approval_flow_node (flow_id, node_order, node_name, approver_type, approver_value, sign_type)
     VALUES
     (:flowId, 1, '项目经理审批', 'project_role', 'manager', 'or'),
     (:flowId, 2, '财务复核', 'role', 'finance:auto', 'or'),
     (:flowId, 3, '总经理审批', 'role', 'gm:auto', 'or')`,
    { flowId },
  );

  return flowId;
}

async function ensureLandscapeCategories() {
  for (const cat of LANDSCAPE_COST_CATEGORIES) {
    await query(
      `INSERT INTO cost_category (code, name, sort_order, status)
       VALUES (:code, :name, :sortOrder, 1)
       ON DUPLICATE KEY UPDATE name = VALUES(name), sort_order = VALUES(sort_order), status = 1`,
      { code: cat.code, name: cat.name, sortOrder: cat.sortOrder },
    );
  }
}

async function seedProjectBudgets(projectId) {
  const categories = await query('SELECT id, code FROM cost_category WHERE status = 1');
  const year = new Date().getFullYear();
  const amounts = {
    SEEDLING: 200000,
    EARTHWORK: 120000,
    LABOR: 150000,
    MACHINE: 80000,
    INDIRECT: 60000,
    MGMT: 50000,
    TRAVEL: 30000,
    OFFICE: 20000,
    OTHER: 50000,
  };
  for (const cat of LANDSCAPE_COST_CATEGORIES) {
    amounts[cat.code] = cat.defaultBudget;
  }

  for (const cat of categories) {
    await query(
      `INSERT INTO project_budget (project_id, cost_category_id, budget_amount, fiscal_year)
       VALUES (:projectId, :catId, :amount, :year)
       ON DUPLICATE KEY UPDATE budget_amount = VALUES(budget_amount), status = 1`,
      { projectId, catId: cat.id, amount: amounts[cat.code] || 50000, year },
    );
  }
}

async function upsertRole(userId, roleCode, { grade = null, regionId = null, projectId = null } = {}) {
  await query(
    `INSERT INTO user_role (user_id, role_code, grade, region_id, project_id, status)
     VALUES (:userId, :roleCode, :grade, :regionId, :projectId, 1)
     ON DUPLICATE KEY UPDATE status = 1, grade = VALUES(grade)`,
    { userId, roleCode, grade, regionId, projectId },
  );
}

async function main() {
  await ensureUserRoleTable();
  await ensureLandscapeCategories();

  const employee = await ensureDevUser();

  const pmA = await upsertUserFromDingTalk({
    userId: 'dev_manager',
    unionId: 'dev_manager_union',
    name: '项目经理A',
    mobile: '13800000001',
    title: '项目经理A',
  });
  const pmB = await upsertUserFromDingTalk({
    userId: 'dev_pm_b',
    unionId: 'dev_pm_b_union',
    name: '项目经理B',
    mobile: '13800000002',
    title: '项目经理B',
  });
  const pmC = await upsertUserFromDingTalk({
    userId: 'dev_pm_c',
    unionId: 'dev_pm_c_union',
    name: '项目经理C',
    mobile: '13800000003',
    title: '项目经理C',
  });

  const financeA = await upsertUserFromDingTalk({
    userId: 'dev_finance_a',
    unionId: 'dev_finance_a_union',
    name: '财务A',
    mobile: '13800000011',
    title: '财务A·项目',
  });
  const financeB = await upsertUserFromDingTalk({
    userId: 'dev_finance_b',
    unionId: 'dev_finance_b_union',
    name: '财务B',
    mobile: '13800000012',
    title: '财务B·片区',
  });
  const financeC = await upsertUserFromDingTalk({
    userId: 'dev_finance_c',
    unionId: 'dev_finance_c_union',
    name: '财务C',
    mobile: '13800000013',
    title: '财务C·公司',
  });

  const gmA = await upsertUserFromDingTalk({
    userId: 'dev_gm_a',
    unionId: 'dev_gm_a_union',
    name: '总经理A',
    mobile: '13800000021',
    title: '总经理A',
  });
  const gmB = await upsertUserFromDingTalk({
    userId: 'dev_gm_b',
    unionId: 'dev_gm_b_union',
    name: '总经理B',
    mobile: '13800000022',
    title: '总经理B',
  });
  const gmC = await upsertUserFromDingTalk({
    userId: 'dev_gm_c',
    unionId: 'dev_gm_c_union',
    name: '总经理C',
    mobile: '13800000023',
    title: '总经理C',
  });

  const employee2 = await upsertUserFromDingTalk({
    userId: 'dev_user_2',
    unionId: 'dev_user_2_union',
    name: '开发测试员2',
    mobile: '13800000099',
    title: '员工',
  });

  const regions = await query('SELECT id FROM region WHERE code = :code', { code: 'HD-GZ' });
  let regionId = regions[0]?.id;
  if (!regionId) {
    const ins = await query(
      'INSERT INTO region (code, name, sort_order) VALUES (:code, :name, 1)',
      { code: 'HD-GZ', name: '广州片区' },
    );
    regionId = ins.insertId;
  }

  const projectDefs = [
    { code: 'HD-2026-001', name: '天河公园绿化提升工程', managerId: pmA.id, financeId: financeA.id },
    { code: 'HD-2026-002', name: '南沙滨海景观带施工', managerId: pmB.id, financeId: financeA.id },
    { code: 'HD-2026-003', name: '番禺市政道路绿化养护', managerId: pmC.id, financeId: financeA.id },
  ];

  for (const p of projectDefs) {
    await query(
      `INSERT INTO project (code, name, region_id, manager_user_id, finance_user_id, status)
       VALUES (:code, :name, :regionId, :managerId, :financeId, 'active')
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         manager_user_id = VALUES(manager_user_id),
         finance_user_id = VALUES(finance_user_id),
         status = 'active'`,
      { ...p, regionId },
    );
  }

  const projByCode = {};
  for (const p of projectDefs) {
    const rows = await query('SELECT id FROM project WHERE code = :code LIMIT 1', { code: p.code });
    projByCode[p.code] = rows[0].id;
    await seedProjectBudgets(rows[0].id);
  }

  await query(
    `INSERT IGNORE INTO project_member (project_id, user_id, role) VALUES (:projectId, :userId, 'member')`,
    { projectId: projByCode['HD-2026-001'], userId: employee.id },
  );
  await query(
    `INSERT IGNORE INTO project_member (project_id, user_id, role) VALUES (:projectId, :userId, 'member')`,
    { projectId: projByCode['HD-2026-002'], userId: employee2.id },
  );
  // 项目经理默认也是成员，便于填单 joined 列表
  await query(
    `INSERT IGNORE INTO project_member (project_id, user_id, role, source) VALUES (:projectId, :userId, 'manager', 'admin')`,
    { projectId: projByCode['HD-2026-001'], userId: pmA.id },
  );
  await query(
    `INSERT IGNORE INTO project_member (project_id, user_id, role, source) VALUES (:projectId, :userId, 'manager', 'admin')`,
    { projectId: projByCode['HD-2026-002'], userId: pmB.id },
  );
  await query(
    `INSERT IGNORE INTO project_member (project_id, user_id, role, source) VALUES (:projectId, :userId, 'manager', 'admin')`,
    { projectId: projByCode['HD-2026-003'], userId: pmC.id },
  );

  // 清空再写入角色，避免历史脏数据
  for (const uid of [employee.id, employee2.id, pmA.id, pmB.id, pmC.id, financeA.id, financeB.id, financeC.id, gmA.id, gmB.id, gmC.id]) {
    await query('DELETE FROM user_role WHERE user_id = :uid', { uid });
  }

  await upsertRole(employee.id, 'employee');
  await upsertRole(employee2.id, 'employee');

  await upsertRole(pmA.id, 'project_manager', { grade: 'A', projectId: projByCode['HD-2026-001'] });
  await upsertRole(pmB.id, 'project_manager', { grade: 'B', projectId: projByCode['HD-2026-002'] });
  await upsertRole(pmC.id, 'project_manager', { grade: 'C', projectId: projByCode['HD-2026-003'] });

  await upsertRole(financeA.id, 'finance', { grade: 'A', projectId: projByCode['HD-2026-001'] });
  await upsertRole(financeA.id, 'finance', { grade: 'A', projectId: projByCode['HD-2026-002'] });
  await upsertRole(financeA.id, 'finance', { grade: 'A', projectId: projByCode['HD-2026-003'] });
  await upsertRole(financeB.id, 'finance', { grade: 'B', regionId });
  await upsertRole(financeC.id, 'finance', { grade: 'C' });

  await upsertRole(gmA.id, 'gm', { grade: 'A' });
  await upsertRole(gmB.id, 'gm', { grade: 'B' });
  await upsertRole(gmC.id, 'gm', { grade: 'C' });

  await ensureApprovalFlow();

  const processCode = process.env.DINGTALK_PROCESS_CODE || '';
  if (processCode) {
    await query(
      `UPDATE sys_config SET config_value = :value WHERE config_key = 'dingtalk.process_code'`,
      { value: processCode },
    );
  }

  if (process.env.APPROVAL_MODE === 'A') {
    await query(`UPDATE sys_config SET config_value = 'A' WHERE config_key = 'approval.mode'`);
  } else if (process.env.NODE_ENV !== 'production') {
    await query(`UPDATE sys_config SET config_value = 'A' WHERE config_key = 'approval.mode'`);
  }

  console.log('[db:seed] personas ready:');
  console.log('  employee     =', employee.id, 'dev_user');
  console.log('  PM A/B/C     =', pmA.id, pmB.id, pmC.id);
  console.log('  Finance A/B/C=', financeA.id, financeB.id, financeC.id);
  console.log('  GM A/B/C     =', gmA.id, gmB.id, gmC.id);
  console.log('[db:seed] approval: 项目经理 → 财务(auto档) → 总经理(auto档, ≤5k跳过)');
  console.log('[db:seed] 可见范围: 员工仅本人 / PM本项目 / 财务A项目·B片区·C全公司 / 总经理全公司');
}

main()
  .then(async () => {
    await closePool();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[db:seed] failed:', err.message);
    await closePool();
    process.exit(1);
  });
