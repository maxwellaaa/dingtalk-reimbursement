# 发布包目录

运行 `npm run pack:release` 生成：

- `dingtalk-reimbursement-<version>.zip`
- `dingtalk-reimbursement-<version>-<时间戳>.zip`
- 对应 `.sha256` 校验文件

zip / sha256 **不入库**（见 `.gitignore`）。上传服务器步骤见 `docs/版本与服务器托管准备-v1.0.0.md`。
