-- 园林施工协作报销平台 · 数据库 DDL
-- 方案 B 主导（含方案 A 共用表）
-- MySQL 8.0+

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE region (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    code            VARCHAR(32)  NOT NULL,
    name            VARCHAR(128) NOT NULL,
    parent_id       BIGINT       NULL,
    sort_order      INT          NOT NULL DEFAULT 0,
    status          TINYINT      NOT NULL DEFAULT 1,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_region_code (code)
) COMMENT='区域';

CREATE TABLE department (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    ding_dept_id    BIGINT       NULL,
    name            VARCHAR(128) NOT NULL,
    parent_id       BIGINT       NULL,
    region_id       BIGINT       NULL,
    sort_order      INT          NOT NULL DEFAULT 0,
    status          TINYINT      NOT NULL DEFAULT 1,
    synced_at       DATETIME     NULL,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_ding_dept (ding_dept_id),
    KEY idx_region (region_id)
) COMMENT='部门';

CREATE TABLE user_account (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    ding_user_id    VARCHAR(64)  NULL,
    ding_union_id   VARCHAR(64)  NULL,
    employee_no     VARCHAR(32)  NULL,
    name            VARCHAR(64)  NOT NULL,
    mobile          VARCHAR(20)  NULL,
    email           VARCHAR(128) NULL,
    dept_id         BIGINT       NULL,
    region_id       BIGINT       NULL,
    user_type       VARCHAR(16)  NOT NULL DEFAULT 'internal',
    title           VARCHAR(64)  NULL,
    bank_account    VARCHAR(64)  NULL,
    bank_name       VARCHAR(128) NULL,
    status          TINYINT      NOT NULL DEFAULT 1,
    synced_at       DATETIME     NULL,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_ding_user (ding_user_id),
    KEY idx_dept (dept_id),
    KEY idx_region (region_id)
) COMMENT='用户';

CREATE TABLE cost_category (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    code            VARCHAR(32)  NOT NULL,
    name            VARCHAR(64)  NOT NULL,
    parent_id       BIGINT       NULL,
    sort_order      INT          NOT NULL DEFAULT 0,
    status          TINYINT      NOT NULL DEFAULT 1,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_cost_code (code)
) COMMENT='成本科目';

CREATE TABLE project (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    code            VARCHAR(32)  NOT NULL,
    name            VARCHAR(256) NOT NULL,
    region_id       BIGINT       NOT NULL,
    contract_no     VARCHAR(64)  NULL,
    manager_user_id BIGINT       NULL,
    finance_user_id BIGINT       NULL,
    start_date      DATE         NULL,
    end_date        DATE         NULL,
    status          VARCHAR(16)  NOT NULL DEFAULT 'active',
    remark          VARCHAR(512) NULL,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_project_code (code),
    KEY idx_region (region_id),
    KEY idx_manager (manager_user_id)
) COMMENT='工程项目';

CREATE TABLE project_member (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id      BIGINT       NOT NULL,
    user_id         BIGINT       NOT NULL,
    role            VARCHAR(32)  NOT NULL DEFAULT 'member',
    source          VARCHAR(16)  NOT NULL DEFAULT 'admin' COMMENT 'self|admin',
    joined_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_project_user (project_id, user_id),
    KEY idx_user (user_id)
) COMMENT='项目成员';

CREATE TABLE vendor (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    code            VARCHAR(32)  NOT NULL,
    name            VARCHAR(256) NOT NULL,
    vendor_type     VARCHAR(16)  NOT NULL,
    contact_name    VARCHAR(64)  NULL,
    contact_mobile  VARCHAR(20)  NULL,
    tax_no          VARCHAR(32)  NULL,
    bank_account    VARCHAR(64)  NULL,
    bank_name       VARCHAR(128) NULL,
    linked_user_id  BIGINT       NULL,
    status          TINYINT      NOT NULL DEFAULT 1,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_vendor_code (code)
) COMMENT='分包商/供应商';

CREATE TABLE project_budget (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id      BIGINT         NOT NULL,
    cost_category_id BIGINT        NOT NULL,
    budget_amount   DECIMAL(18,2)  NOT NULL DEFAULT 0,
    fiscal_year     SMALLINT       NOT NULL,
    warn_threshold  DECIMAL(5,2)   NOT NULL DEFAULT 0.90,
    status          TINYINT        NOT NULL DEFAULT 1,
    created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_proj_cat_year (project_id, cost_category_id, fiscal_year)
) COMMENT='项目科目预算';

CREATE TABLE budget_ledger (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id      BIGINT         NOT NULL,
    cost_category_id BIGINT        NOT NULL,
    reimbursement_id BIGINT        NULL,
    change_amount   DECIMAL(18,2)  NOT NULL,
    balance_after   DECIMAL(18,2)  NOT NULL,
    biz_type        VARCHAR(32)    NOT NULL,
    remark          VARCHAR(256)   NULL,
    created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_project (project_id),
    KEY idx_reimb (reimbursement_id)
) COMMENT='预算流水';

CREATE TABLE reimbursement (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    bill_no         VARCHAR(32)    NOT NULL,
    project_id      BIGINT         NOT NULL,
    applicant_user_id BIGINT       NOT NULL,
    dept_id         BIGINT         NULL,
    region_id       BIGINT         NULL,
    vendor_id       BIGINT         NULL,
    title           VARCHAR(256)   NOT NULL,
    total_amount    DECIMAL(18,2)  NOT NULL DEFAULT 0,
    reimburse_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
    payee_name      VARCHAR(64)    NULL,
    payee_account   VARCHAR(64)    NULL,
    payee_bank      VARCHAR(128)   NULL,
    expense_date    DATE           NOT NULL,
    description     VARCHAR(1024)  NULL,
    status          VARCHAR(16)    NOT NULL DEFAULT 'draft',
    submit_at       DATETIME       NULL,
    approved_at     DATETIME       NULL,
    paid_at         DATETIME       NULL,
    approval_mode   VARCHAR(8)     NOT NULL DEFAULT 'A',
    budget_exception_type   VARCHAR(32)  NULL COMMENT '无预算例外：temp_project|petty_cash|special_approval',
    budget_exception_remark VARCHAR(512) NULL COMMENT '预算例外说明',
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
    invoice_code    VARCHAR(32)    NULL,
    invoice_no      VARCHAR(32)    NOT NULL,
    invoice_type    VARCHAR(32)    NOT NULL DEFAULT 'vat_normal',
    invoice_date    DATE           NULL,
    amount          DECIMAL(18,2)  NULL,
    tax_amount      DECIMAL(18,2)  NULL,
    total_amount    DECIMAL(18,2)  NULL,
    buyer_name      VARCHAR(256)   NULL,
    buyer_tax_no    VARCHAR(32)    NULL,
    seller_name     VARCHAR(256)   NULL,
    seller_tax_no   VARCHAR(32)    NULL,
    check_code      VARCHAR(32)    NULL,
    status          VARCHAR(16)    NOT NULL DEFAULT 'pending',
    verify_result   VARCHAR(16)    NULL,
    verify_at       DATETIME       NULL,
    duplicate_flag  TINYINT        NOT NULL DEFAULT 0,
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
    biz_type        VARCHAR(32)    NOT NULL,
    biz_id          BIGINT         NOT NULL,
    file_name       VARCHAR(256)   NOT NULL,
    file_path       VARCHAR(512)   NOT NULL,
    file_size       BIGINT         NOT NULL DEFAULT 0,
    mime_type       VARCHAR(64)    NULL,
    sha256          VARCHAR(64)    NULL,
    uploaded_by     BIGINT         NULL,
    created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_biz (biz_type, biz_id)
) COMMENT='附件';

CREATE TABLE approval_flow (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    code            VARCHAR(32)    NOT NULL,
    name            VARCHAR(128)   NOT NULL,
    region_id       BIGINT         NULL,
    project_id      BIGINT         NULL,
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
    node_name       VARCHAR(64)    NOT NULL,
    approver_type   VARCHAR(16)    NOT NULL,
    approver_value  VARCHAR(128)   NULL,
    sign_type       VARCHAR(8)     NOT NULL DEFAULT 'or',
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
) COMMENT='审批实例';

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
) COMMENT='审批任务';

CREATE TABLE dingtalk_oa_mapping (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT,
    reimbursement_id        BIGINT       NOT NULL,
    process_code            VARCHAR(128) NOT NULL,
    process_instance_id     VARCHAR(128) NULL,
    originator_ding_user_id VARCHAR(64)  NULL,
    sync_status             VARCHAR(16)  NOT NULL DEFAULT 'pending',
    last_event_type         VARCHAR(32)  NULL,
    last_event_at           DATETIME     NULL,
    raw_create_response     JSON         NULL,
    raw_last_event          JSON         NULL,
    created_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_reimb (reimbursement_id),
    UNIQUE KEY uk_instance (process_instance_id),
    KEY idx_sync (sync_status)
) COMMENT='钉钉OA审批映射';

CREATE TABLE user_role (
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
) COMMENT='用户审批角色与可见范围';

CREATE TABLE dingtalk_api_usage (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    stat_month      CHAR(7)        NOT NULL,
    api_name        VARCHAR(64)    NOT NULL,
    call_count      INT            NOT NULL DEFAULT 0,
    updated_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_month_api (stat_month, api_name)
) COMMENT='钉钉API调用计数';

CREATE TABLE sys_config (
    config_key      VARCHAR(64)    PRIMARY KEY,
    config_value    VARCHAR(1024)  NOT NULL,
    remark          VARCHAR(256)   NULL,
    updated_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) COMMENT='系统配置';

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
    job_name        VARCHAR(64)    NOT NULL,
    status          VARCHAR(16)    NOT NULL,
    message         VARCHAR(1024)  NULL,
    started_at      DATETIME       NOT NULL,
    finished_at     DATETIME       NULL
) COMMENT='定时任务日志';

INSERT INTO sys_config (config_key, config_value, remark) VALUES
('approval.mode', 'B', 'B=钉钉OA A=自研审批'),
('dingtalk.process_code', '', '报销OA模板 processCode'),
('budget.strict_mode', 'true', '超预算拦截；未配置预算可走临时人员采购/临时项目/备用金/特批等例外'),
('invoice.duplicate_check', 'true', '发票查重'),
('invoice.verify_enabled', 'false', '是否启用第三方验真'),
('api.usage.warn_threshold', '8000', '月API调用预警阈值'),
('approval.finance_a_max', '5000', '财务A档金额上限（含）'),
('approval.finance_b_max', '50000', '财务B档金额上限（含）'),
('approval.gm_a_max', '50000', '总经理A档金额上限（含）'),
('approval.gm_b_max', '200000', '总经理B档金额上限（含）');

INSERT INTO cost_category (code, name, sort_order) VALUES
('SEEDLING', '苗木材料', 1),
('EARTHWORK', '土方工程', 2),
('LABOR', '劳务费', 3),
('MACHINE', '机械租赁', 4),
('INDIRECT', '间接费', 5),
('MGMT', '管理费', 6),
('TRAVEL', '差旅交通', 7),
('OFFICE', '办公费', 8),
('MECH_FEE', '机械费', 10),
('REPAIR', '维修费', 11),
('PETTY_BUY', '零星采购', 12),
('TEMP_LABOR', '临时用工', 13),
('SAFETY_CIVIL', '安全文明施工', 14),
('SEASONAL_GEAR', '雨季高温临时用具', 15),
('ENTERTAIN', '应酬费', 16),
('OTHER', '其他', 99);

SET FOREIGN_KEY_CHECKS = 1;
