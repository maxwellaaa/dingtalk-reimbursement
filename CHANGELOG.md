# Changelog

## [1.0.0] — 2026-07-30

首个**服务器托管就绪**版本（P0–P5 交付 + 角色/项目成员/自动审批路径）。

### 能力摘要

- 钉钉 H5 免登、报销填报/附件、自研审批与方案 B OA+Stream
- 预算占用/释放、发票查重与 OCR、报表导出
- Docker / PM2 生产部署、备份脚本、管理员手册
- 角色分配（项目经理 / 财务 A–C / 总经理）；冷启动 SQL 写入首位总经理
- 项目成员由财务/总经理/项目经理分配；员工不可自助入组，分配后才可见项目
- 提交/审批按项目自动流转（本项目经理 → 本项目财务 → 大额总经理）
- 驳回单支持「修改并重新申请」

### 托管交付物

- `docker-compose.prod.yml` + `.env.production.example`
- `deploy/`、`scripts/deploy/`、`scripts/backup/`
- `scripts/pack-release.ps1` → `releases/dingtalk-reimbursement-1.0.0.zip`

### 升级说明

全新部署：按 `docs/P5-部署说明.md` / `docs/版本与服务器托管准备-v1.0.0.md`。  
从开发库迁移：导出 MySQL + `uploads/`，在服务器执行 `db:init` 后导入业务数据。

---

## [0.1.0] — 2026-07-01

P0–P5 初版开发完成（本地验证）。
