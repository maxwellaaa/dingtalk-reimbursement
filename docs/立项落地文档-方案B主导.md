# 园林施工企业协作报销平台 · 立项落地文档

> **主导方案：B**（钉钉标准版免费 + 自研 H5 + 免费 OA 审批 + 事件回写）  
> **备选降本：A**（全自研审批，去掉 OA 审批 API，在关键收费/限额节点可切换）  
> **目标**：年维护成本 0.3–0.8 万元，尽量少用或不用钉钉收费功能

| 文档版本 | v1.0 |
|----------|------|
| 适用企业 | 园林工程施工，多工地、多区域、含分包协作 |
| 参考规模 | 内部员工 ~150 人，年报销单 ~3,000 笔 |
| 数据库 | MySQL 8.0+ / PostgreSQL 14+（下文以 MySQL 语法为主） |

---

## 1. 方案总览

### 1.1 方案 B 数据流（主导）

```
员工 H5 填单 → 自研后端校验（预算/查重）→ 写本地库
    → 调用钉钉「发起审批实例」API → 审批人在钉钉 OA 原生页操作
    → bpms_instance_change 事件回写 → 更新报销单状态 → 项目成本归集 / 报表
```

### 1.2 方案 A 降级点（收费/限额触发时）

| 触发条件 | 方案 B 行为 | 切换方案 A |
|----------|-------------|------------|
| 标准版 API 接近 1 万次/月 | 继续用 OA 审批 | 关闭「创建审批实例」，改自研审批 + 工作通知 |
| 不愿购买 OA 审批高级版 | 无法用批量审批中心 API | 自研 H5 审批页（本就不依赖高级版） |
| 事件 Stream 超 5,000 次/月 | 依赖事件回写 | 改为「审批完成后人工同步」或低频补偿任务 |
| 未来强制购买智能财务 | 不使用 | 保持自研发票池，不受影响 |

> **原则**：自研库始终是**唯一业务真相源**；钉钉 OA 在方案 B 中只是「审批 UI + 消息通道」，可随时剥离。

---

## 2. 数据库表结构

### 2.1 ER 关系概览

```
region ─┬─ department ── user
        │
project ─┬─ project_budget ── budget_ledger
         ├─ project_member
         └─ reimbursement ─┬─ reimbursement_item ── invoice
                           └─ approval_instance ── approval_task
                                    │
                           dingtalk_oa_mapping（方案 B）
```

### 2.2 枚举与字典

```sql
-- 报销单状态
-- draft / pending / approving / approved / rejected / paid / cancelled

-- 审批任务状态
-- pending / approved / rejected / transferred / cancelled

-- 发票状态
-- pending / recognized / verified / duplicate / invalid

-- 用户类型
-- internal / external（分包/供应商）

-- 方案模式（系统配置）
-- mode_b（默认） / mode_a
```

### 2.3 组织与主数据

```sql
-- 区域（总部-分公司-片区）
CREATE TABLE region (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    code            VARCHAR(32)  NOT NULL COMMENT '区域编码，如 HD-GZ',
    name            VARCHAR(128) NOT NULL,
    parent_id       BIGINT       NULL,
    sort_order      INT          NOT NULL DEFAULT 0,
    status          TINYINT      NOT NULL DEFAULT 1 COMMENT '1启用 0停用',
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_region_code (code)
) COMMENT='区域';

-- 部门（与钉钉 dept_id 映射）
CREATE TABLE department (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    ding_dept_id    BIGINT       NULL COMMENT '钉钉部门ID',
    name            VARCHAR(128) NOT NULL,
    parent_id       BIGINT       NULL,
    region_id       BIGINT       NULL,
    sort_order      INT          NOT NULL DEFAULT 0,
    status          TINYINT      NOT NULL DEFAULT 1,
    synced_at       DATETIME     NULL COMMENT '最近一次通讯录同步',
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_ding_dept (ding_dept_id),
    KEY idx_region (region_id)
) COMMENT='部门';

-- 用户（与钉钉 userid 映射）
CREATE TABLE user_account (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    ding_user_id    VARCHAR(64)  NULL COMMENT '钉钉 userid',
    ding_union_id   VARCHAR(64)  NULL COMMENT '钉钉 unionId，待办等接口用',
    employee_no     VARCHAR(32)  NULL COMMENT '工号',
    name            VARCHAR(64)  NOT NULL,
    mobile          VARCHAR(20)  NULL,
    email           VARCHAR(128) NULL,
    dept_id         BIGINT       NULL,
    region_id       BIGINT       NULL,
    user_type       VARCHAR(16)  NOT NULL DEFAULT 'internal' COMMENT 'internal/external',
    title           VARCHAR(64)  NULL COMMENT '岗位：项目经理/财务等',
    bank_account    VARCHAR(64)  NULL COMMENT '默认收款账号',
    bank_name       VARCHAR(128) NULL,
    status          TINYINT      NOT NULL DEFAULT 1 COMMENT '1在职 0离职',
    synced_at       DATETIME     NULL,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_ding_user (ding_user_id),
    KEY idx_dept (dept_id),
    KEY idx_region (region_id)
) COMMENT='用户';

-- 成本科目（园林施工）
CREATE TABLE cost_category (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    code            VARCHAR(32)  NOT NULL COMMENT '如 LABOR/MATERIAL/MACHINE',
    name            VARCHAR(64)  NOT NULL COMMENT '劳务/苗木材料/机械租赁/间接费/管理费',
    parent_id       BIGINT       NULL,
    sort_order      INT          NOT NULL DEFAULT 0,
    status          TINYINT      NOT NULL DEFAULT 1,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_cost_code (code)
) COMMENT='成本科目';

-- 工程项目
CREATE TABLE project (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    code            VARCHAR(32)  NOT NULL COMMENT '项目编号 HD-2026-001',
    name            VARCHAR(256) NOT NULL,
    region_id       BIGINT       NOT NULL,
    contract_no     VARCHAR(64)  NULL,
    manager_user_id BIGINT       NULL COMMENT '项目经理',
    finance_user_id BIGINT       NULL COMMENT '项目财务对接人',
    start_date      DATE         NULL,
    end_date        DATE         NULL,
    status          VARCHAR(16)  NOT NULL DEFAULT 'active' COMMENT 'active/closed/suspended',
    remark          VARCHAR(512) NULL,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_project_code (code),
    KEY idx_region (region_id),
    KEY idx_manager (manager_user_id)
) COMMENT='工程项目';

-- 项目成员（含外部协作方可见范围）
CREATE TABLE project_member (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id      BIGINT       NOT NULL,
    user_id         BIGINT       NOT NULL,
    role            VARCHAR(32)  NOT NULL COMMENT 'manager/finance/member/viewer/external',
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_project_user (project_id, user_id),
    KEY idx_user (user_id)
) COMMENT='项目成员';

-- 分包商/供应商（可选，外部联系人扩展）
CREATE TABLE vendor (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    code            VARCHAR(32)  NOT NULL,
    name            VARCHAR(256) NOT NULL,
    vendor_type     VARCHAR(16)  NOT NULL COMMENT 'subcontract/supplier/other',
    contact_name    VARCHAR(64)  NULL,
    contact_mobile  VARCHAR(20)  NULL,
    tax_no          VARCHAR(32)  NULL,
    bank_account    VARCHAR(64)  NULL,
    bank_name       VARCHAR(128) NULL,
    linked_user_id  BIGINT       NULL COMMENT '关联外部联系人 user_account',
    status          TINYINT      NOT NULL DEFAULT 1,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_vendor_code (code)
) COMMENT='分包商/供应商';
```

### 2.4 预算与费控

```sql
CREATE TABLE project_budget (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id      BIGINT         NOT NULL,
    cost_category_id BIGINT        NOT NULL,
    budget_amount   DECIMAL(18,2)  NOT NULL DEFAULT 0,
    fiscal_year     SMALLINT       NOT NULL COMMENT '预算年度',
    warn_threshold  DECIMAL(5,2)   NOT NULL DEFAULT 0.90 COMMENT '预警比例，如0.9=90%',
    status          TINYINT        NOT NULL DEFAULT 1,
    created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_proj_cat_year (project_id, cost_category_id, fiscal_year)
) COMMENT='项目科目预算';

-- 预算流水（审批通过后扣减，驳回/撤回回滚）
CREATE TABLE budget_ledger (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id      BIGINT         NOT NULL,
    cost_category_id BIGINT        NOT NULL,
    reimbursement_id BIGINT        NULL,
    change_amount   DECIMAL(18,2)  NOT NULL COMMENT '负数=占用，正数=释放',
    balance_after   DECIMAL(18,2)  NOT NULL,
    biz_type        VARCHAR(32)    NOT NULL COMMENT 'occupy/release/adjust',
    remark          VARCHAR(256)   NULL,
    created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_project (project_id),
    KEY idx_reimb (reimbursement_id)
) COMMENT='预算流水';
```

### 2.5 报销核心业务

```sql
CREATE TABLE reimbursement (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    bill_no         VARCHAR(32)    NOT NULL COMMENT '报销单号 RB202606300001',
    project_id      BIGINT         NOT NULL,
    applicant_user_id BIGINT       NOT NULL,
    dept_id         BIGINT         NULL,
    region_id       BIGINT         NULL,
    vendor_id       BIGINT         NULL COMMENT '代分包报销时填写',
    title           VARCHAR(256)   NOT NULL,
    total_amount    DECIMAL(18,2)  NOT NULL DEFAULT 0,
    reimburse_amount DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '实际报销金额',
    payee_name      VARCHAR(64)    NULL,
    payee_account   VARCHAR(64)    NULL,
    payee_bank      VARCHAR(128)   NULL,
    expense_date    DATE           NOT NULL COMMENT '费用发生日期',
    description     VARCHAR(1024)  NULL,
    status          VARCHAR(16)    NOT NULL DEFAULT 'draft',
    submit_at       DATETIME       NULL,
    approved_at     DATETIME       NULL,
    paid_at         DATETIME       NULL,
    approval_mode   VARCHAR(8)     NOT NULL DEFAULT 'B' COMMENT 'B=钉钉OA A=自研审批',
    created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_bill_no (bill_no),
    KEY idx_project (project_id),
    KEY idx_applicant (applicant_user_id),
    KEY idx_status (status),
    KEY idx_submit (submit_at)
) COMMENT='报销单主表';

CREATE TABLE reimbursement_item (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    reimbursement_id BIGINT        NOT NULL,
    line_no         INT            NOT NULL DEFAULT 1,
    cost_category_id BIGINT         NOT NULL,
    amount          DECIMAL(18,2)  NOT NULL,
    tax_amount      DECIMAL(18,2)  NOT NULL DEFAULT 0,
    description     VARCHAR(512)   NULL,
    invoice_id      BIGINT         NULL,
    created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_reimb (reimbursement_id),
    KEY idx_invoice (invoice_id)
) COMMENT='报销明细行';

CREATE TABLE invoice (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    invoice_code    VARCHAR(32)    NULL COMMENT '发票代码，数电票可为空',
    invoice_no      VARCHAR(32)    NOT NULL COMMENT '发票号码',
    invoice_type    VARCHAR(32)    NOT NULL DEFAULT 'vat_normal' COMMENT 'vat_special/vat_normal/electronic/other',
    invoice_date    DATE           NULL,
    amount          DECIMAL(18,2)  NULL COMMENT '不含税金额',
    tax_amount      DECIMAL(18,2)  NULL,
    total_amount    DECIMAL(18,2)  NULL,
    buyer_name      VARCHAR(256)   NULL,
    buyer_tax_no    VARCHAR(32)    NULL,
    seller_name     VARCHAR(256)   NULL,
    seller_tax_no   VARCHAR(32)    NULL,
    check_code      VARCHAR(32)    NULL COMMENT '校验码后6位',
    status          VARCHAR(16)    NOT NULL DEFAULT 'pending',
    verify_result   VARCHAR(16)    NULL COMMENT 'valid/invalid/unknown',
    verify_at       DATETIME       NULL,
    duplicate_flag  TINYINT        NOT NULL DEFAULT 0 COMMENT '1=重复',
    ocr_raw_json    JSON           NULL,
    uploaded_by     BIGINT         NULL,
    created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_invoice (invoice_no, invoice_code),
    KEY idx_status (status),
    KEY idx_duplicate (duplicate_flag)
) COMMENT='发票池';

CREATE TABLE file_attachment (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    biz_type        VARCHAR(32)    NOT NULL COMMENT 'invoice/reimburse/other',
    biz_id          BIGINT         NOT NULL,
    file_name       VARCHAR(256)   NOT NULL,
    file_path       VARCHAR(512)   NOT NULL COMMENT '本地路径或 OSS key',
    file_size       BIGINT         NOT NULL DEFAULT 0,
    mime_type       VARCHAR(64)    NULL,
    sha256          VARCHAR(64)    NULL,
    uploaded_by     BIGINT         NULL,
    created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_biz (biz_type, biz_id)
) COMMENT='附件';
```

### 2.6 审批引擎（方案 A/B 共用）

```sql
-- 审批流模板（按区域/项目类型可配置多条）
CREATE TABLE approval_flow (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    code            VARCHAR(32)    NOT NULL COMMENT '如 REIMB_DEFAULT',
    name            VARCHAR(128)   NOT NULL,
    region_id       BIGINT         NULL COMMENT 'NULL=全局',
    project_id      BIGINT         NULL COMMENT 'NULL=非项目专用',
    min_amount      DECIMAL(18,2)  NULL,
    max_amount      DECIMAL(18,2)  NULL,
    status          TINYINT        NOT NULL DEFAULT 1,
    created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_flow_code (code)
) COMMENT='审批流定义';

CREATE TABLE approval_flow_node (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    flow_id         BIGINT         NOT NULL,
    node_order      INT            NOT NULL,
    node_name       VARCHAR(64)    NOT NULL COMMENT '项目经理/区域财务/总部财务',
    approver_type   VARCHAR(16)    NOT NULL COMMENT 'fixed/project_role/dept_leader/self_select',
    approver_value  VARCHAR(128)   NULL COMMENT 'user_id 或 role 名',
    sign_type       VARCHAR(8)     NOT NULL DEFAULT 'or' COMMENT 'or=或签 and=会签',
    created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_flow (flow_id)
) COMMENT='审批节点';

CREATE TABLE approval_instance (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    reimbursement_id BIGINT        NOT NULL,
    flow_id         BIGINT         NOT NULL,
    status          VARCHAR(16)    NOT NULL DEFAULT 'pending',
    current_node_order INT         NULL,
    started_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at     DATETIME       NULL,
    UNIQUE KEY uk_reimb (reimbursement_id)
) COMMENT='审批实例（自研）';

CREATE TABLE approval_task (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    instance_id     BIGINT         NOT NULL,
    node_order      INT            NOT NULL,
    assignee_user_id BIGINT        NOT NULL,
    status          VARCHAR(16)    NOT NULL DEFAULT 'pending',
    comment         VARCHAR(512)   NULL,
    acted_at        DATETIME       NULL,
    created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_instance (instance_id),
    KEY idx_assignee (assignee_user_id, status)
) COMMENT='审批任务（方案A直接使用；方案B作镜像）';
```

### 2.7 钉钉 OA 映射（方案 B 专用，方案 A 可空置）

```sql
CREATE TABLE dingtalk_oa_mapping (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT,
    reimbursement_id        BIGINT       NOT NULL,
    process_code            VARCHAR(128) NOT NULL COMMENT 'OA审批模板 processCode',
    process_instance_id     VARCHAR(128) NULL COMMENT '钉钉审批实例ID',
    originator_ding_user_id VARCHAR(64)  NULL,
    sync_status             VARCHAR(16)  NOT NULL DEFAULT 'pending' COMMENT 'pending/synced/finished/failed',
    last_event_type         VARCHAR(32)  NULL COMMENT 'start/finish/terminate',
    last_event_at           DATETIME     NULL,
    raw_create_response     JSON         NULL,
    raw_last_event          JSON         NULL,
    created_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_reimb (reimbursement_id),
    UNIQUE KEY uk_instance (process_instance_id),
    KEY idx_sync (sync_status)
) COMMENT='钉钉OA审批映射';

-- 钉钉 API 用量统计（监控是否需降级方案A）
CREATE TABLE dingtalk_api_usage (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    stat_month      CHAR(7)        NOT NULL COMMENT 'YYYY-MM',
    api_name        VARCHAR(64)    NOT NULL,
    call_count      INT            NOT NULL DEFAULT 0,
    updated_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_month_api (stat_month, api_name)
) COMMENT='钉钉API调用计数';
```

### 2.8 系统配置与审计

```sql
CREATE TABLE sys_config (
    config_key      VARCHAR(64)    PRIMARY KEY,
    config_value    VARCHAR(1024)  NOT NULL,
    remark          VARCHAR(256)   NULL,
    updated_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) COMMENT='系统配置';

-- 初始配置建议
INSERT INTO sys_config (config_key, config_value, remark) VALUES
('approval.mode', 'B', 'B=钉钉OA A=自研审批'),
('dingtalk.process_code', '', '报销OA模板 processCode，配置后填入'),
('budget.strict_mode', 'true', '超预算是否拦截'),
('invoice.duplicate_check', 'true', '发票查重'),
('invoice.verify_enabled', 'false', '是否启用第三方验真'),
('api.usage.warn_threshold', '8000', '月API调用预警阈值');

CREATE TABLE sys_audit_log (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id         BIGINT         NULL,
    action          VARCHAR(64)    NOT NULL,
    biz_type        VARCHAR(32)    NULL,
    biz_id          BIGINT         NULL,
    ip              VARCHAR(64)    NULL,
    detail_json     JSON           NULL,
    created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_biz (biz_type, biz_id),
    KEY idx_time (created_at)
) COMMENT='审计日志';

CREATE TABLE sys_job_log (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    job_name        VARCHAR(64)    NOT NULL COMMENT 'contact_sync/backup/api_report',
    status          VARCHAR(16)    NOT NULL,
    message         VARCHAR(1024)  NULL,
    started_at      DATETIME       NOT NULL,
    finished_at     DATETIME       NULL
) COMMENT='定时任务日志';
```

### 2.9 索引与分区建议

| 表 | 建议 |
|----|------|
| `reimbursement` | 按 `submit_at` 年度归档历史表（>3 年） |
| `invoice` | 定期清理 `ocr_raw_json` 大字段到冷存储 |
| `sys_audit_log` | 按月分区或 12 个月滚动删除 |
| 全库 | 每日凌晨 `mysqldump` + 附件目录 rsync |

### 2.10 单据号生成规则

```
报销单号：RB + yyyyMMdd + 4位序号（Redis/DB 序列表）
项目编号：{区域码}-{年份}-{3位序号}
```

---

## 3. 钉钉自建应用配置清单

### 3.1 前置条件

- [ ] 企业已认证钉钉组织（标准版即可，**无需专业版**）
- [ ] 指定 1 名**主管理员** + 1 名**开发运维**（开发者后台权限）
- [ ] 准备 HTTPS 域名（备案）及服务器公网 IP
- [ ] 后端服务已部署：`https://reimb.example.com`

### 3.2 创建企业内部应用

| 步骤 | 操作 | 说明 |
|------|------|------|
| 1 | 登录 [钉钉开放平台](https://open-dev.dingtalk.com/) | 使用管理员账号 |
| 2 | 应用开发 → 钉钉应用 → **创建应用** | 类型：**企业内部开发** |
| 3 | 应用名称 | `园林协作报销`（员工可见名） |
| 4 | 应用描述 | 项目费用报销、发票管理 |
| 5 | 开发方式 | 选择 **企业自主开发** |
| 6 | 记录凭证 | **AppKey (Client ID)**、**AppSecret (Client Secret)** → 写入服务器环境变量 |

```env
DINGTALK_APP_KEY=dingxxxxxxxx
DINGTALK_APP_SECRET=xxxxxxxx
DINGTALK_AGENT_ID=123456789
DINGTALK_CORP_ID=dingxxxxxxxx
```

### 3.3 应用能力配置

| 配置项 | 路径 | 设置值 |
|--------|------|--------|
| 应用类型 | 应用详情 → 基础信息 | **H5 微应用** |
| 首页地址 | 开发管理 → 开发设置 → 应用首页地址 | `https://reimb.example.com/h5/` |
| PC 首页 | 同上 | `https://reimb.example.com/h5/` |
| 管理后台地址 | 可选 | `https://reimb.example.com/admin/` |
| 可见范围 | 版本管理与发布 → 可见范围 | **全部员工**（或按部门） |

### 3.4 权限申请清单（方案 B 最小集）

在 **开发配置 → 权限管理** 中搜索并申请：

| 权限名称 | 用途 | 方案 A 是否必需 |
|----------|------|-----------------|
| 成员信息读权限 | 通讯录同步 | ✅ |
| 部门信息读权限 | 组织架构 | ✅ |
| 个人手机号信息 | 展示联系人 | 可选 |
| 工作流实例写权限 | **发起 OA 审批** | ❌ 方案 A 不需要 |
| 工作流实例读权限 | 查询审批详情（补偿） | ❌ 方案 A 不需要 |
| 工作流审批任务读权限 | 任务状态补偿 | ❌ |
| 待办应用中待办写权限 | 方案 A 待办提醒 | 方案 A ✅ |
| 工作通知消息权限 | 两种方案消息推送 | ✅ |
| 媒体文件上传/下载 | 可选，建议附件走自建 OSS | ❌ |

> **不要申请**：OA 审批高级版专享权限、智能财务、宜搭相关权限。

### 3.5 OA 审批模板配置（方案 B 核心）

在 **钉钉管理后台 → OA 审批 → 创建表单**：

#### 3.5.1 表单字段（与自研库映射）

| 序号 | 控件类型 | 字段名（name） | 必填 | 映射 `reimbursement` |
|------|----------|----------------|------|----------------------|
| 1 | 单行输入框 | 报销单号 | 是 | `bill_no` |
| 2 | 单行输入框 | 项目编号 | 是 | `project.code` |
| 3 | 单行输入框 | 项目名称 | 是 | `project.name` |
| 4 | 单行输入框 | 费用类型 | 是 | 明细科目汇总 |
| 5 | 数字输入框 | 报销金额 | 是 | `reimburse_amount` |
| 6 | 日期 | 费用发生日期 | 是 | `expense_date` |
| 7 | 多行输入框 | 报销说明 | 否 | `description` |
| 8 | 附件 | 发票及凭证 | 是 | `file_attachment` |
| 9 | 单行输入框 | 详情链接 | 是 | H5 详情 URL（隐藏或只读） |

#### 3.5.2 审批流程（示例）

```
发起人 → 项目经理（审批）→ 区域财务（审批）→ 总部财务（审批）
         ↑ 条件：金额>5000 加签总部财务
         ↑ 条件：金额>50000 加签总经理（可选）
```

#### 3.5.3 记录模板编码

- [ ] 发布审批模板
- [ ] 在 OA 审批设置中获取 **processCode**（形如 `PROC-XXXX-XXXX`）
- [ ] 写入 `sys_config.dingtalk.process_code`
- [ ] 在自研管理后台「钉钉配置」页校验连通性

### 3.6 事件订阅配置（方案 B，方案 A 可关闭）

路径：**开发配置 → 事件订阅**

| 配置项 | 值 |
|--------|-----|
| 订阅方式 | **Stream 模式**（推荐，免公网回调）或 HTTP 回调 |
| 加密 aes_key | 平台生成，写入环境变量 |
| 签名 token | 平台生成，写入环境变量 |
| 订阅事件 | `bpms_instance_change` |
| 过滤规则 | `/v1.0/event/bpms_instance_change/processCode/{processCode}/type/finish` |
| | `/v1.0/event/bpms_instance_change/processCode/{processCode}/type/terminate` |

**事件处理逻辑（后端）：**

```
收到 finish + result=agree  → reimbursement.status=approved → 扣预算
收到 finish + result=refuse → reimbursement.status=rejected  → 释放预算
收到 terminate              → reimbursement.status=cancelled
```

> Stream 调用量计入 5,000 次/月；3000 单/年远低于上限。

### 3.7 工作台发布

| 步骤 | 操作 |
|------|------|
| 1 | 开发者后台 → 版本管理与发布 → **创建版本** |
| 2 | 填写更新说明 |
| 3 | 管理员在 **工作台 → 应用管理** 启用应用 |
| 4 | 将「园林协作报销」固定到常用应用 |
| 5 | 通知全员：工作台 → 园林协作报销 → 提交报销 |

### 3.8 配置验收 Checklist

- [ ] H5 免登成功，能获取当前用户 `userid`
- [ ] 通讯录同步任务跑通，部门/人员入库
- [ ] 测试报销单提交 → 钉钉 OA 出现审批单
- [ ] 审批人在 OA 内同意 → 事件回写 → 自研库状态变 `approved`
- [ ] 驳回流程状态正确，预算未扣减
- [ ] 发票查重生效（同号重复拦截）
- [ ] 超预算拦截或预警生效
- [ ] API 用量仪表盘可见（自研统计页）

---

## 4. 方案 B 核心接口时序

### 4.1 提交报销

```
1. H5 POST /api/reimbursements  { projectId, items[], invoices[] }
2. 服务端：校验预算、发票查重、生成 bill_no、status=draft→pending
3. POST https://api.dingtalk.com/v1.0/workflow/processInstances
   - processCode, originatorUserId, formComponentValueList
4. 写入 dingtalk_oa_mapping，status=synced
5. dingtalk_api_usage.call_count += 1
6. 返回 { billNo, h5DetailUrl }
```

### 4.2 审批完成（事件驱动，不轮询）

```
1. Stream 收到 bpms_instance_change (type=finish)
2. 查 dingtalk_oa_mapping by process_instance_id
3. 更新 reimbursement.status
4. approved → budget_ledger 扣减；rejected → 结束
5. 可选：发送工作通知给发起人
```

### 4.3 降级方案 A 时改动点

| 原方案 B | 方案 A 替换 |
|----------|-------------|
| 步骤 3 创建 OA 实例 | 创建 `approval_instance` + `approval_task` |
| OA 原生审批 | H5 审批页 `/approve/:taskId` |
| 事件订阅 | 删除/停用 Stream；任务状态自研维护 |
| 工作通知 | 通知审批人「有待办报销」+ 跳转 H5 |

切换方式：修改 `sys_config.approval.mode = 'A'`，无需改表结构。

---

## 5. 年度维护 SOP

### 5.1 维护节奏总览

| 频率 | 任务 | 负责人 | 预估工时 |
|------|------|--------|----------|
| 每日（自动） | 数据库备份、API 用量统计 | 脚本 | 0 |
| 每周（自动） | 通讯录增量同步 | 脚本 | 0 |
| 每月 | 备份恢复抽检、日志清理 | 运维 | 0.5h |
| 每季度 | 权限审计、依赖补丁评估 | 运维+财务 | 2h |
| **每年** | **全面维护（见 5.2）** | 运维 | **1–2 人天** |
| 按需 | 新项目/新区域上线 | 财务+运维 | 0.5h/项目 |

### 5.2 年度全面维护 Checklist（建议每年 6 月或 12 月）

#### A. 基础设施

- [ ] 操作系统安全补丁：`apt/yum update` 或云厂商镜像升级
- [ ] Docker / Nginx / MySQL 小版本升级（先在测试环境验证）
- [ ] SSL 证书有效期检查（Let's Encrypt 自动续期是否成功）
- [ ] 磁盘使用率 < 70%；发票附件目录归档到冷存储
- [ ] 执行一次**完整备份恢复演练**（恢复到测试库并抽查 10 条报销单）

#### B. 钉钉侧

- [ ] 开发者后台 → 检查 AppSecret 是否泄露；必要时轮换并更新服务器
- [ ] 事件订阅 Stream 连接状态正常
- [ ] 审批模板 `processCode` 未因误删重建（若变更需同步 `sys_config`）
- [ ] 查看 **API 用量**：近 12 个月峰值是否 > 8,000 次/月
  - 若接近上限 → 评估切换方案 A 或购买专业版（9,800 元/年，**最后手段**）
- [ ] 离职人员：确认审批流中无离职员工作为固定审批人
- [ ] 应用可见范围与新组织架构一致

#### C. 业务配置

- [ ] 财务提供新项目清单 → 录入 `project` + `project_budget`
- [ ] 更新 `approval_flow` 节点（新项目经理、区域财务）
- [ ] 核对成本科目是否需要新增（如「养护费」）
- [ ] 导出年度报销汇总 CSV，与 ERP/总账对账一次

#### D. 应用与依赖

- [ ] 后端依赖 `npm audit` / `maven versions` 检查高危 CVE
- [ ] 前端 H5 在最新版钉钉客户端冒烟测试（提交→审批→回写）
- [ ] 检查 `sys_config` 配置项合理性

#### E. 文档与交接

- [ ] 更新《管理员操作手册》中的审批人名单
- [ ] 记录本年度变更日志到 `docs/CHANGELOG.md`
- [ ] 确认至少 2 人掌握服务器与钉钉后台访问方式

### 5.3 月度自动任务（cron 示例）

```cron
# 每天 02:00 全量备份
0 2 * * * /opt/reimb/scripts/backup.sh

# 每天 03:00 通讯录同步
0 3 * * * /opt/reimb/scripts/sync-contacts.sh

# 每月 1 日 09:00 API 用量报告（邮件/钉钉通知）
0 9 1 * * /opt/reimb/scripts/api-usage-report.sh

# 每月 1 日 04:00 清理 90 天前 job_log
0 4 1 * * mysql -e "DELETE FROM sys_job_log WHERE started_at < DATE_SUB(NOW(), INTERVAL 90 DAY)"
```

### 5.4 故障应急

| 现象 | 排查 | 处理 |
|------|------|------|
| 提交后 OA 无审批单 | 查 `dingtalk_oa_mapping.sync_status=failed` | 看 API 错误码；processCode 是否正确 |
| 审批完成但状态未更新 | Stream 是否断连 | 重启 Stream 客户端；手动补偿接口 `/admin/sync-oa/{id}` |
| API 超限 429 | 查 `dingtalk_api_usage` | **立即切换方案 A**；关闭创建 OA 实例 |
| 服务器宕机 | 云监控告警 | 恢复备份；RTO 目标 < 4h |

### 5.5 方案 A 紧急切换 Runbook（5 分钟内）

```
1. 管理后台 → 系统配置 → approval.mode = A
2. 停用 Stream 事件订阅（或停止 stream 进程）
3. 重启后端服务
4. 通知审批人：后续在「园林协作报销」H5 内审批
5. 进行中的 OA 审批单：允许在 OA 内审完；事件仍回写（可保留 Stream 只读）
   或人工在管理后台标记状态
6. 新单不再调用创建 OA 实例 API
```

---

## 6. 关键收费节点与方案 A 保留策略

| 节点 | 方案 B 依赖 | 触发的钉钉能力 | 免费？ | 方案 A 降级 |
|------|-------------|----------------|--------|-------------|
| N1 发起审批 | 创建审批实例 API | 标准 OA API | ✅ 计入1万次 | 不自建 OA 实例，改自研 task |
| N2 审批操作 | OA 原生页 | 无 API | ✅ | H5 内 approve/reject |
| N3 状态同步 | Stream 事件 | 事件推送 | ✅ 5000次/月 | 手动同步/定时补偿 |
| N4 查询审批详情 | 偶发补偿查询 | 读 API | ✅ | 仅信自研库 |
| N5 批量审批中心 | 不使用 | OA 高级版 API | ❌ 收费 | 从不依赖 |
| N6 智能财务验真 | 不使用 | 智能财务 | ❌ 收费 | 自研查重+可选第三方按次 |
| N7 宜搭表单 | 不使用 | 宜搭 | ❌ 收费 | 自研 H5 |
| N8 API >1万/月 | 可能触发 | 专业版 | ❌ 9800/年 | **优先改方案 A** |
| N9 附件钉盘 | 可选 | 钉盘 API | 免费额度内 | 全部走自建 OSS |

---

## 7. 立项交付物清单

| 交付物 | 状态 |
|--------|------|
| 本文档（表结构 + 钉钉配置 + 年维 SOP） | ✅ |
| DDL 脚本 `schema.sql` | 待开发阶段导出 |
| H5 原型 + 管理后台 | 待开发 |
| Docker Compose 部署包 | 待开发 |
| 《管理员操作手册》 | 待上线前 |
| 《方案 A 切换演练记录》 | 待上线后首次演练 |

---

## 8. 附录：成本科目初始数据

```sql
INSERT INTO cost_category (code, name, sort_order) VALUES
('SEEDLING', '苗木材料', 1),
('EARTHWORK', '土方工程', 2),
('LABOR', '劳务费', 3),
('MACHINE', '机械租赁', 4),
('INDIRECT', '间接费', 5),
('MGMT', '管理费', 6),
('TRAVEL', '差旅交通', 7),
('OFFICE', '办公费', 8),
('OTHER', '其他', 99);
```

---

*文档维护：每次审批流变更、钉钉模板变更、方案 A/B 切换后更新本节版本号。*
