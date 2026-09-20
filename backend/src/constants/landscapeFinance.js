/**
 * 园林工程费用科目 & 无预算例外类型（前后端语义对齐）
 */

/** 新增/维护的园林工程科目（seed & migrate 共用） */
export const LANDSCAPE_COST_CATEGORIES = [
  { code: 'MECH_FEE', name: '机械费', sortOrder: 10, defaultBudget: 80000 },
  { code: 'REPAIR', name: '维修费', sortOrder: 11, defaultBudget: 40000 },
  { code: 'PETTY_BUY', name: '零星采购', sortOrder: 12, defaultBudget: 30000 },
  { code: 'TEMP_LABOR', name: '临时用工', sortOrder: 13, defaultBudget: 100000 },
  { code: 'SAFETY_CIVIL', name: '安全文明施工', sortOrder: 14, defaultBudget: 50000 },
  { code: 'SEASONAL_GEAR', name: '雨季高温临时用具', sortOrder: 15, defaultBudget: 25000 },
  { code: 'ENTERTAIN', name: '应酬费', sortOrder: 16, defaultBudget: 30000 },
];

/**
 * 无年度预算时的例外提交类型
 * suggestCategoryCodes：选中这些科目时优先推荐该例外
 */
export const BUDGET_EXCEPTION_TYPE_DEFS = {
  temp_staff_purchase: {
    label: '临时人员采购',
    desc: '项目临时人员代采材料、工具、劳保用品等，凭票核销',
    suggestCategoryCodes: ['TEMP_LABOR', 'PETTY_BUY', 'SEASONAL_GEAR', 'REPAIR'],
    remarkPlaceholder: '如：临时人员张三代购安全帽/雨衣，现场负责人确认…',
  },
  seasonal_emergency: {
    label: '雨季高温应急',
    desc: '雨季排水、防暑降温等临时用具/物资应急采购',
    suggestCategoryCodes: ['SEASONAL_GEAR', 'SAFETY_CIVIL', 'PETTY_BUY'],
    remarkPlaceholder: '如：连续高温采购清凉饮料/遮阳网；暴雨应急抽水泵…',
  },
  temp_project: {
    label: '临时项目',
    desc: '未正式立项或临时交办的园林工程费用',
    suggestCategoryCodes: ['MECH_FEE', 'TEMP_LABOR', 'PETTY_BUY'],
    remarkPlaceholder: '如：业主临时交办补植，项目编号/会议纪要…',
  },
  petty_cash: {
    label: '备用金',
    desc: '项目备用金垫付后报销核销',
    suggestCategoryCodes: ['PETTY_BUY', 'OFFICE', 'TRAVEL'],
    remarkPlaceholder: '如：备用金账户垫付，核销单号…',
  },
  special_approval: {
    label: '特批',
    desc: '领导书面或钉钉特批后报销',
    suggestCategoryCodes: ['ENTERTAIN'],
    remarkPlaceholder: '如：特批钉钉审批号 / 批示截图说明…',
  },
};

export function listBudgetExceptionTypes() {
  return Object.entries(BUDGET_EXCEPTION_TYPE_DEFS).map(([value, def]) => ({
    value,
    label: def.label,
    desc: def.desc,
    suggestCategoryCodes: def.suggestCategoryCodes,
    remarkPlaceholder: def.remarkPlaceholder,
  }));
}

export function isValidBudgetExceptionType(type) {
  return !!BUDGET_EXCEPTION_TYPE_DEFS[type];
}

export function budgetExceptionLabel(type) {
  return BUDGET_EXCEPTION_TYPE_DEFS[type]?.label || type || '';
}

/** 根据已选科目推荐例外类型（命中 suggest 最多者优先，默认临时人员采购） */
export function suggestBudgetExceptionType(categoryCodes = []) {
  const codes = new Set((categoryCodes || []).filter(Boolean));
  if (!codes.size) return 'temp_staff_purchase';

  let best = 'temp_staff_purchase';
  let bestScore = -1;
  for (const [value, def] of Object.entries(BUDGET_EXCEPTION_TYPE_DEFS)) {
    const score = (def.suggestCategoryCodes || []).filter((c) => codes.has(c)).length;
    if (score > bestScore) {
      bestScore = score;
      best = value;
    }
  }
  return bestScore > 0 ? best : 'temp_staff_purchase';
}
