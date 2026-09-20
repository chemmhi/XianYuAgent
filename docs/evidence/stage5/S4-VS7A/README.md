# S4-VS7A Settings API Key 证据

日期：2026-09-20

## 真实浏览器 / 跨层

- 命令：`npm run test:e2e:chrome:settings`
- 环境：Chrome headless + CDP、Vite live API proxy、API harness、MemoryStore/stub adapter。
- 通过项：`/settings` 真实入口、账号选择、empty → create → saved、secret 不进入 URL/body/localStorage/input、403 未授权账号、409 stale version、rotate、disable、revoke、撤销后不可恢复。
- 输出：`screenshots/settings-desktop-1440x900.png`、`screenshots/settings-mobile-390x844.png`。

## PostgreSQL 持久化

- 迁移：临时 PostgreSQL 数据库执行 `001`–`018`，包含 `018_credential_store.sql`。
- 命令：`npm --workspace apps/api run test:postgres:credentials`。
- 通过项：`credential_refs` / `credential_values` 真实写入；`ciphertext` 以 `v1.` AES-256-GCM 载荷保存；ciphertext 不等于明文；checksum 与 fingerprint 一致；API list 不返回明文。
- 证据脚本：`apps/api/scripts/credential-store-postgres-smoke.mjs`。

## 视觉复核

- 桌面：保留原型的左侧设置分类、右侧内容卡片、账号范围 chip、CredentialStore 列表与操作按钮。
- 移动：隐藏主侧栏，设置分类切换改为短标签横向导航，保留底部四项设置导航；390px 视口无横向页面溢出。
- 当前偏差：新建/轮换弹窗与列表操作为本切片真实交互，原型中的其他设置分区仍是后续切片参考面板，不宣称全部设置后台能力已完成。

## 尚未关闭

- 018 的发布级 rollback / 已有生产 volume 回退演练尚未执行。
- 旧 `auth.account_credentials` 明文凭证的双读单写迁移与兼容窗口仍需独立设计；本切片只保证新 API Key CredentialStore 不回显明文。
- 因此切片状态保持 `READY_FOR_REVIEW`，不标记 `PASS`。
