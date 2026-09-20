# 园林协作报销 · 钉钉 H5 微应用

> **版本 1.0.0** · P0–P5 交付，服务器托管就绪  
> 变更记录：[CHANGELOG.md](./CHANGELOG.md) · 托管准备：[docs/版本与服务器托管准备-v1.0.0.md](./docs/版本与服务器托管准备-v1.0.0.md)

## 项目结构

```
dingtalk-reimbursement/
├── backend/          # Express API（钉钉 OAuth、JWT、审批）
├── frontend/         # Vue3 H5 微应用
├── database/         # schema.sql
├── deploy/           # Nginx / PM2
├── scripts/          # 部署、备份、pack-release
├── releases/         # 发布 zip（本地生成，不入库）
└── docs/             # 立项与运维文档
```

## 发布打包（上传服务器前）

```powershell
npm run pack:release
# → releases/dingtalk-reimbursement-1.0.0.zip
```

## 手机真机联调（一键）

1. 确认 **MySQL 已开**、已装 [cpolar](https://www.cpolar.com/)
2. 双击项目根目录 **`一键启动-手机真机.cmd`**（或 `npm run mobile:start`）
3. 按清单更新钉钉「应用首页」为 `https://…/h5/`、「安全域名」为主机名
4. 手机钉钉工作台打开微应用；结束用 **`一键停止-手机真机.cmd`**

可选：双击 `创建桌面快捷方式.cmd`，以后从桌面启动。

## 参数归档（v1.0.0）

全部可配置参数索引（不含密钥明文）：

[`docs/参数归档-v1.0.0/开发参数归档.md`](docs/参数归档-v1.0.0/开发参数归档.md)

## 本地开发

### 0. 准备 MySQL 8

**方式 A — Docker（推荐）**

```powershell
cd dingtalk-reimbursement
docker compose up -d mysql
# 等待约 30 秒后初始化
cd backend
npm run db:init
npm run db:seed
```

**方式 B — 本机 MySQL**

创建数据库与用户后执行：

```sql
CREATE DATABASE reimbursement DEFAULT CHARACTER SET utf8mb4;
CREATE USER 'reimb'@'%' IDENTIFIED BY 'reimb123';
GRANT ALL ON reimbursement.* TO 'reimb'@'%';
```

然后 `npm run db:init` 和 `npm run db:seed`。

### 1. 配置钉钉应用

1. 登录 [钉钉开放平台](https://open-dev.dingtalk.com/) 创建**企业内部应用**
2. 开启 **H5 微应用**，应用首页填：`http://localhost:5173/h5/`（开发）或生产 HTTPS 地址
3. 申请权限：**成员信息读**、**部门信息读**（通讯录同步 P1 用）
4. 复制 AppKey、AppSecret、AgentId、CorpId

### 2. 启动服务（需要两个终端，缺一不可）

**终端 1 — 后端**

```powershell
cd backend
npm run dev
```

看到 `[backend] P0 running at http://localhost:3000` 表示成功。

**终端 2 — 前端（Vite 开发服务器，浏览器访问靠它）**

```powershell
cd frontend
npm run dev
```

看到 `Local: http://localhost:5173/h5/` 后，浏览器打开该地址。

> 若报 `ERR_CONNECTION_REFUSED`，说明**前端未启动**（只跑了 `npm run build` 不会占用 5173 端口）。

Vite 已配置 `/api` 代理到后端。

**浏览器调试**：非钉钉环境会自动调用 `POST /api/auth/dev-login`，使用测试账号「开发测试员」。

### 5. 钉钉内调试

- 开发阶段可用 [钉钉开发者工具](https://open.dingtalk.com/document/resourcedownload/download-tools) 或内网穿透（ngrok / frp）将 H5 暴露为 HTTPS
- 钉钉应用首页必须与实际访问 URL 一致（含 `/h5/` 路径）
- 在钉钉工作台打开应用，应自动完成免登并显示用户名

## API（P0 + P1）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查（`version` / `db` / `phase`） |
| POST | `/api/auth/dev-login` | 开发环境模拟登录 |
| GET | `/api/projects` | 项目列表 |
| GET | `/api/cost-categories` | 成本科目 |
| POST | `/api/files` | 上传附件（multipart） |
| GET | `/api/files/:id` | 下载附件 |
| GET | `/api/reimbursements` | 我的报销列表 |
| POST | `/api/reimbursements` | 创建草稿 |
| GET | `/api/reimbursements/:id` | 报销详情 |
| PUT | `/api/reimbursements/:id` | 更新草稿 |
| POST | `/api/reimbursements/:id/submit` | 提交（P2 接 OA） |
| DELETE | `/api/reimbursements/:id` | 删除草稿 |

## Docker 部署

开发栈：

```bash
cp .env.example .env
docker compose up -d --build
```

生产栈见 **[docs/P5-部署说明.md](docs/P5-部署说明.md)**、**[docs/版本与服务器托管准备-v1.0.0.md](docs/版本与服务器托管准备-v1.0.0.md)** 与 **[docs/管理员手册.md](docs/管理员手册.md)**。

- 开发：前端 `http://localhost:8080/h5/`，后端 `http://localhost:3000`
- 生产：`docker compose -f docker-compose.prod.yml up -d --build`
- 健康检查应返回 `"version":"1.0.0"`

生产环境请使用 HTTPS 反向代理，并将钉钉应用首页改为 `https://your-domain/h5/`。

## 方案 A 降级提示

若 OA API 超限，可切换 `approval.mode=A`（自研 H5 待办），免登层无需改动。
