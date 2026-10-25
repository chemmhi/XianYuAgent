# 账号永久删除验收证据

全部截图和账号均为隔离测试夹具，不含生产 Cookie、Token 或账号标识。

- delete-desktop.png：1440×900 永久删除确认说明。
- delete-mobile.png：390×844 相同确认弹窗，按钮和全文可见。
- result.json：Chrome/CDP → 正式页面 → API → 隔离 PostgreSQL + 真实 MinIO → 邀请注册用户重新绑定的业务断言。

可复现命令：

```powershell
npm --workspace apps/api run test:account-delete
npm --workspace apps/web run test:e2e:chrome:account-delete
```

依赖：本机 Chrome；隔离 PostgreSQL 默认端口 55434（INVITE_TEST_DATABASE_URL 可覆盖，测试自动建库/迁移/删库）；MinIO 默认 19000（项目测试凭证）；隔离 Redis 默认 56379（ACCOUNT_DELETE_REDIS_URL 可覆盖）。MinIO 镜像仓库当前不可直接拉取，本次只读导出腾讯云已有相同镜像在本地运行；未修改生产服务。

真实闲鱼 adapter 不在该隔离证据中，扫码需发布后由真实用户复验。桌面/移动截图已人工视觉检查，沿用现有账号弹窗样式，无新增视觉系统。

新增发布验收：18 项专项包含真实历史批量清理、跨用户账号保留、恢复账号原子保护、迁移 runner 连续重放两次；6 项部署规则测试与 bash -n 只读语法检查通过。
