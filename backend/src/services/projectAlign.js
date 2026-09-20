/**
 * 工地协作整合（GATEWAY_MODE）：报销项目仅以考勤同步工地为准
 */
import { config } from '../config.js';

/** @returns {{ sql: string, params: Record<string, unknown> }} */
export function attendanceAlignedProjectWhere(alias = 'p') {
  if (!config.gatewayMode) {
    return { sql: '1=1', params: {} };
  }
  return { sql: `${alias}.attendance_site_id IS NOT NULL`, params: {} };
}

export function appendAlignedProjectFilter(baseWhere, alias = 'p') {
  const vis = attendanceAlignedProjectWhere(alias);
  const sql = baseWhere ? `${baseWhere} AND ${vis.sql}` : vis.sql;
  return { sql, params: { ...vis.params } };
}
