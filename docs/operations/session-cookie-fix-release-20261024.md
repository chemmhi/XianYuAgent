# 会话 Cookie 完整性修复发布（2026-10-24）

## 目标和验收

用户最终验收只有生产账号“逐星智能”恢复正常。此次代码切片修复会话数据丢失及浏览器属性漏传；本地测试通过、提交合并或部署成功都不能代替该业务验收。上线后仍须只读核验真实账号状态与常驻服务连接情况。

生产账号 UUID：`1d274de5-38b8-4c9b-83ed-d8ba803685ac`。2026-10-24 13:13:47 +08:00 生产只读查询仍为 `verification_required` / `disconnected`，风险来源为 `mtop.taobao.idlemessage.pc.login.token`。这不是此次发布后的结果。

## 修改前的检查和模块边界

- 生产/远程 main 基线：`76c3b34c0f3553e60fc23e354c357dd49482f331`。
- 历史修复来源：`88271c6`、`b89a5b0`、`68702a7`。仅选择下表文件，不整体 cherry-pick 诊断分支。
- 原有结构：MTOP 客户端处理请求及 Set-Cookie；Cookie jar 处理快照/元数据；IM 服务合并会话；浏览器适配层传递 Cookie 属性。
- 影响边界：没有公开 API、依赖、数据库结构或前端变化。没有将历史实验 Token/profile 导入生产，也没有新增自动解题实现。
- 行为标准：失效快照不能覆盖完整会话；响应增量不能删除仍有效的会话 Cookie；旋转值不能沿用旧过期时间；已知域、路径和安全/分区属性不能在适配时丢失。

| 正式文件 | 必要修改 |
| --- | --- |
| `apps/api/src/xianyu-cookie-jar.ts` | 为合并型元数据持久化提供明确的失效标记；保存 Chromium 分区属性 |
| `apps/api/src/xianyu-mtop.ts` | 快照与原始 Cookie 不一致时关闭旧 jar 模式，基于完整 Cookie 合并响应增量并保存失效标记 |
| `apps/api/src/xianyu-im-service.ts` | 增量更新保留已有 Cookie 属性；值旋转且无新有效期时移除旧有效期 |
| `apps/api/src/xianyu-verification-browser.ts` | 传递已有 partitionKey 和跨站祖先标记 |

测试文件：`xianyu-mtop-cookie-fallback.test.ts`、`xianyu-im-credential.test.ts`、`xianyu-verification-port.test.ts`、`xianyu-cookie-jar-smoke.mjs`，均位于 `apps/api/scripts/`。

## 已执行验证

在独立 worktree 先仅导入新回归测试，保留旧生产实现，实际出现快照合并和属性丢失失败；随后导入上述四个生产文件，运行：

```powershell
# apps/api 目录
node --import tsx --test scripts/xianyu-mtop-cookie-fallback.test.ts scripts/xianyu-im-credential.test.ts scripts/xianyu-verification-port.test.ts scripts/credential-service.test.ts scripts/xianyu-cookie-login-update.test.ts scripts/account-login-recovery.test.ts
node --import tsx --test scripts/xianyu-account-health.test.ts scripts/xianyu-verification-browser.test.ts scripts/xianyu-qr-verification-browser.test.ts
# 仓库根目录
npm run build:api
node apps/api/scripts/xianyu-cookie-jar-smoke.mjs
git diff --check
```

结果：33/33 和 12/12；API 编译、Cookie jar 检查通过。包含真实本地 Chrome 的受控页面验证及 CredentialService/MemoryStore 合并路径，不把受控网络响应当作真实平台结果。

未执行：PostgreSQL 专项、全量业务 E2E、真实平台新挑战。Docker 本地引擎当时不可用；没有使用生产数据库补做写入测试。前端/视觉不适用，因为没有页面变更。结论为“该代码切片本地验证通过”，不是“生产账号已恢复”。

原始日志保存在本地忽略目录 `artifacts/slider-recording/20261024-session-cookie-fix/`；此前封存资料及原始值保持不变，入口见 [事实审计](./account-session-audit-20261024.md)。

## 合并与发布约束

- 用户明确要求合入本地 main 并推送 GitHub main；该指令作为本次合并授权。
- 本地主线既有未推送的开发端口提交和未提交的订单修改必须保留；远程 main 只接收本次必要文件。发布提交与本地主线可存在尚未发布的本地历史差异，需记录精确 SHA。
- 本地合并遵守共享 Git common dir 的原子 merge lock；临时保护未提交内容后须恢复并校验原始工作区及索引。
- 正式发布只能更新 GitHub main，由既有 Actions 校验同一 SHA 并调用 `scripts/deploy-production.sh`。不在服务器修改源码，不上传本地源码，不手工写回实验凭证。
- 核验分为：远程 main SHA、Actions 结果、服务器 Git/静态发布 SHA、健康检查、真实账号状态。每一项分别记录，不互相替代。
- 回滚采用已验证代码提交及既有发布路径；本切片没有数据库迁移，不以覆盖账号数据回滚代码。

## 当前交付状态

本文件随代码提交；推送与部署结果需根据后续真实观察补充。此处不预先填成功，不删除仍存在的生产风险状态。
