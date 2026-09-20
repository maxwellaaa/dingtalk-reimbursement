# 钉钉手机真机 · 一键脚本

## 最快用法（推荐）

在项目**根目录**双击（推荐英文名，兼容性更好）：

| 文件 | 作用 |
|------|------|
| `start-mobile.cmd` / `一键启动-手机真机.cmd` | 启动 backend + frontend + cpolar |
| `stop-mobile.cmd` / `一键停止-手机真机.cmd` | 停 cpolar，恢复 FRONTEND_URL |
| `stop-mobile-all.cmd` | 穿透 + 前后端一并停 |
| `创建桌面快捷方式.cmd` | 桌面生成 `DingTalk-Reimburse-Mobile.lnk` |

也可：`npm run mobile:start` / `npm run mobile:stop`

## 首次准备

1. 安装 [cpolar](https://www.cpolar.com/)，执行 `cpolar authtoken <token>`
2. MySQL 已启动；`backend/.env` 已填钉钉凭证
3. 双击 `一键启动-手机真机.cmd`
4. 按弹出清单，到钉钉开放平台改 **应用首页**（必须带 `/h5/`）和 **安全域名**
5. 手机钉钉 → 工作台 → 打开微应用

> 根路径 `https://xxx.cpolar.top/` 会 404；正确地址是 `https://xxx.cpolar.top/h5/`。

## 本目录文件

| 文件 | 作用 |
|------|------|
| `start-dingtalk-mobile.ps1` | 启动逻辑；`-SkipCpolar` 仅本机 |
| `stop-dingtalk-mobile.ps1` | 停止；`-All` 关前后端；`-RestoreFrontendUrl` 恢复域名 |
| `create-desktop-shortcut.ps1` | 桌面快捷方式 |
| `out/dingtalk-mobile-checklist.txt` | 最近一次联调清单 |

## PowerShell

```powershell
cd "F:\obsidian知识库\cursor\dingtalk-reimbursement\scripts\mobile-tunnel"
.\start-dingtalk-mobile.ps1
.\stop-dingtalk-mobile.ps1 -RestoreFrontendUrl
.\stop-dingtalk-mobile.ps1 -All -RestoreFrontendUrl
```
