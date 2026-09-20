# P4 · 钉钉免费 OA 审批对接指南

> 方案 B 主导：H5 提交 → 钉钉 OA 原生审批 → 事件回写状态  
> 方案 A 降级：无 processCode / dev_user 时自动走自研 H5 审批

---

## 1. 已实现能力

| 模块 | 说明 |
|------|------|
| OA 发起 | `createOaApprovalInstance`，表单字段与模板 label 对齐 |
| 事件回写 | Stream `bpms_instance_change` + HTTP `/api/webhooks/dingtalk/oa` |
| 配置 API | `GET /api/config/approval` |
| 开发模拟 | `POST /api/approvals/webhooks/oa-instance`、`scripts/simulate-oa-event.js` |
| 前端 | 详情页 OA 状态卡片；提交成功按 A/B 区分提示 |
| 验证 | `npm run verify:p4` |

---

## 2. OA 表单字段映射

钉钉 OA 模板控件 **名称（label）** 须与下表完全一致：

| 模板控件 | 系统来源 | 备注 |
|----------|----------|------|
| 报销单号 | `reimbursement.bill_no` | 单行文本 |
| 项目编号 | `project.code` | 单行文本 |
| 项目名称 | `project.name` | 单行文本 |
| 费用类型 | 明细科目汇总 | 单行文本 |
| 报销金额 | `reimburse_amount` | 数字 |
| 费用发生日期 | `expense_date` | 日期 |
| 报销说明 | `description` / `title` | 多行文本 |
| 详情链接 | H5 详情 URL | 单行文本，建议只读 |
| 发票及凭证 | 附件文件名列表 | 见下文限制 |

环境变量 `DINGTALK_OA_ATTACHMENT_LABEL` 可覆盖附件控件名（若模板用「附件」则设为 `附件`）。

### 附件限制（免费方案）

钉钉 OA **附件控件** 需先通过钉盘/媒体 API 上传获得 `fileId`，本系统附件存于本地 `uploads/`。  
当前实现：**将附件文件名写入文本**（或改用单行文本控件「附件清单」）。  
审批人可通过「详情链接」打开 H5 下载真实文件。  
若未来接入钉盘上传，可替换 `buildReimbursementFormValues` 中的附件逻辑。

---

## 3. 钉钉开放平台配置 Checklist（标准版免费）

### 3.1 前置

- [ ] 企业已认证（标准版即可）
- [ ] 创建**企业内部应用**，记录 AppKey / AppSecret / AgentId / CorpId
- [ ] 后端 `.env` 填入凭证

### 3.2 权限（开发配置 → 权限管理）

- [ ] 成员信息读、部门信息读
- [ ] **工作流实例写**（发起 OA）
- [ ] **工作流实例读**（可选，补偿查询）
- [ ] 工作通知消息

### 3.3 OA 审批模板（管理后台 → OA 审批）

- [ ] 按 §2 创建表单字段（名称一字不差）
- [ ] 配置审批流：项目经理 → 区域财务 → …
- [ ] 发布模板，复制 **processCode**（`PROC-XXXX-XXXX`）
- [ ] 写入 `.env`：`DINGTALK_PROCESS_CODE=PROC-...`  
  或 `sys_config.dingtalk.process_code`（启动时自动从 env 同步）

### 3.4 事件订阅（二选一或并存）

#### 方式 A：Stream（推荐，免公网）

1. 开发者后台 → 开发配置 → **事件订阅**
2. 订阅方式：**Stream 模式**
3. 订阅事件：`bpms_instance_change`
4. 过滤（可选）：
   - `/v1.0/event/bpms_instance_change/processCode/{processCode}/type/finish`
   - `/v1.0/event/bpms_instance_change/processCode/{processCode}/type/terminate`
5. 后端启动后日志应出现：`[stream] 钉钉事件 Stream 已连接`
6. `.env`：`DINGTALK_STREAM_ENABLED=true`（默认）

#### 方式 B：HTTP 回调（需公网 HTTPS）

1. 事件订阅 → **HTTP 推送**
2. 回调 URL：`https://your-domain.com/api/webhooks/dingtalk/oa`
3. 配置 Token、EncodingAESKey，写入 `.env`：
   ```env
   DINGTALK_CALLBACK_TOKEN=...
   DINGTALK_CALLBACK_AES_KEY=...
   DINGTALK_CORP_ID=...
   ```
4. 保存后钉钉会发 URL 验证请求，后端自动响应加密 challenge

### 3.5 应用发布

- [ ] 创建版本并发布
- [ ] 工作台启用应用，H5 首页指向 `FRONTEND_URL/h5/`

---

## 4. 环境变量

```env
DINGTALK_APP_KEY=
DINGTALK_APP_SECRET=
DINGTALK_AGENT_ID=
DINGTALK_CORP_ID=
DINGTALK_PROCESS_CODE=PROC-XXXX-XXXX
DINGTALK_STREAM_ENABLED=true
# HTTP 回调（可选）
DINGTALK_CALLBACK_TOKEN=
DINGTALK_CALLBACK_AES_KEY=
# 附件控件 label（默认 发票及凭证）
# DINGTALK_OA_ATTACHMENT_LABEL=附件
# 开发模拟 webhook 密钥（可选）
# WEBHOOK_SECRET=dev-secret
```

开发环境 `db:seed` 默认 `approval.mode=A`（dev_user 无真实钉钉 OA）；生产配置 processCode 后设 `approval.mode=B`。

---

## 5. API 参考

| 接口 | 说明 |
|------|------|
| `GET /api/config/approval` | 当前模式、processCode 是否配置（脱敏）、Stream/Webhook 状态 |
| `POST /api/webhooks/dingtalk/oa` | 钉钉 HTTP 事件回调 |
| `POST /api/approvals/webhooks/oa-instance` | 开发模拟 OA 事件 |

模拟请求示例：

```json
{
  "reimbursementId": 1,
  "type": "finish",
  "result": "agree"
}
```

`type`：`start` | `finish` | `terminate` | `delete`  
`finish` 时 `result`：`agree` | `refuse`

---

## 6. 开发 vs 生产测试

### 开发（无真实钉钉）

```powershell
cd backend
npm run db:seed          # 默认 mode A
npm run verify:p4        # 单元 + OA 事件模拟

# 手动模拟（需先写入 dingtalk_oa_mapping 或以 B 模式提交）
node scripts/simulate-oa-event.js --reimbId=1 --type=finish --result=agree

# 经 HTTP 模拟
node scripts/simulate-oa-event.js --reimbId=1 --type=finish --result=agree --http=true
```

浏览器：dev-login 提交报销 → 方案 A 走 H5 待办；若强制 B 需真实钉钉 userid + processCode。

### 生产

1. 配置全部 env，设 `approval.mode=B`
2. 重启后端，确认 Stream 连接或 HTTP 回调验证通过
3. 真实员工 H5 提交 → 钉钉 OA 出现审批单
4. 审批人同意/驳回 → 检查报销单状态与预算流水
5. `GET /api/config/approval` 确认 `processCodeConfigured: true`

---

## 7. 故障排查

| 现象 | 排查 |
|------|------|
| 提交后无 OA 单 | processCode、工作流写权限、表单字段名 |
| OA 发起失败仍草稿 | 查 `dingtalk_oa_mapping.sync_status=failed` 与 `raw_create_response` |
| 审完状态未更新 | Stream 是否连接；或 HTTP 回调是否可达 |
| dev 自动降级 A | 正常：dev_user 非真实钉钉用户 |

---

## 8. 降级方案 A

```sql
UPDATE sys_config SET config_value = 'A' WHERE config_key = 'approval.mode';
```

或 `.env`：`APPROVAL_MODE=A`，重启后端。新单不再调用 OA 创建 API。

---

*文档版本：P4 · 2026-07-01*
