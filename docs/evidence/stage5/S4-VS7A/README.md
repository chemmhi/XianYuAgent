# S4-VS7A OpenAI API 主备配置证据

日期：2026-09-21
切片：`S4-VS7A`  受控范围：Settings → OpenAI API

## 用户路径

真实 Chrome/CDP 入口为 `/settings` → `OpenAI API`：

1. 明确选择闲鱼账号；
2. 主配置、备用配置分别填写 Provider / Base URL / API Key；
3. 展开 Model 下拉时调用 provider `/models`，不在正式 UI 中内置模型 id；
4. 每张卡片分别点击“测试连通性”和“保存”；
5. 浏览器回读 API 脱敏配置；
6. Agent 首次使用主配置，更新主配置后无需重启即使用新配置，主配置返回 401 后自动切备用；
7. PostgreSQL 重启后再次执行 Agent，仍命中持久化的备用配置。

## 代码边界

- API：`apps/api/src/openai-settings.ts`、`apps/api/src/app.ts`、`apps/api/src/store-postgres.ts`。
- 数据：`apps/api/migrations/024_openai_model_configs.sql` 解除单凭证唯一约束；角色写入 `credential_values.metadata_json`，密钥继续由 CredentialStore 加密保存。
- 前端：`apps/web/src/features/settings/components/OpenAISettingsPanel.tsx`、`settings.css`、`openai-controller.ts`。
- E2E：`apps/web/scripts/e2e-settings-openai-chrome.mjs`。

## 实际验证

### API / 单测

- `npm --workspace apps/api run build`
- `node --import tsx --test apps/api/scripts/openai-settings.test.ts`
- `node --import tsx --test apps/api/scripts/model-provider.test.ts`

覆盖主/备角色唯一性、版本冲突、跨账号拒绝、密钥不回显、provider-owned 模型列表、Agent 动态读取、更新后无重启生效和主失败切备用。

### PostgreSQL

命令：

```powershell
$env:DATABASE_URL="postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/xianyu_agent"
npm --workspace apps/api run migrate
npm --workspace apps/api run test:postgres:openai
```

结果：PASS。真实 `accounts.credential_refs` / `accounts.credential_values` 写入并复读；密文以 `v1.` 形式保存，明文不出现在数据库或 API；主、备两行和 provider `/models` 均通过。

### Chrome/CDP 跨层 E2E

命令：

```powershell
$env:E2E_DATABASE_URL="postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/xianyu_agent"
npm --workspace apps/web run test:e2e:chrome:settings:openai
```

结果：PASS（真实 Chrome/CDP → Vite → API → PostgreSQL → Agent）。

- Agent 输出：`PRIMARY_V1_REPLY` → `PRIMARY_V2_REPLY` → `BACKUP_REPLY`。
- 更新主配置后版本从 1 → 2，无需重启命中新 Provider。
- PostgreSQL 重启复读后仍命中备用配置；浏览器重载后主/备卡片回到“待测试”，主动测试主配置后正确回显“测试通过，已生效”。
- 密钥不进入 URL、页面正文、输入框或 localStorage。
- 已保存 API Key 按真实长度以开头四位 + 中间 `*` + 结尾四位脱敏回显；聚焦编辑时不会把密文或明文写回页面。
- `fallbackAudit=false`：当前 runtime store 没有可查询的 fallback 专用审计事件，主备切换行为本身已通过；该项保留为开放风险，不能宣称完整 fallback 审计闭环。

### 外部真实 provider 检查

仓库 `.env` 当前启用的是主配置（`https://api.nightyu.com/v1` / `gpt-5.6-sol`，密钥不记录）；第二套真实配置（`https://api.deepseek.com` / `deepseek-flash`，密钥不记录）保持为注释态。为验证“注释配置也可作为备用配置使用”，测试进程仅临时加载第二套注释配置，不改写 `.env`，分别完成 `/models` 与文本生成实测，均返回 HTTP 200 且模型列表包含所选模型。两套真实 provider 均已验证，密钥未写入证据、日志或截图。

## 视觉证据

固定 viewport：

- 桌面：`1440×900`
- 移动：`390×844`

截图：

- `screenshots/settings-openai-primary-success-desktop-1440x900.png`
- `screenshots/settings-openai-primary-success-mobile-390x844.png`
- `screenshots/settings-openai-fallback-desktop-1440x900.png`
- `screenshots/settings-openai-fallback-mobile-390x844.png`

视觉复核结论：SellerAgent 的深色侧栏、设置分类列表、白色面板、双列主备卡、浅蓝比较摘要、时间线规则行、绿色成功态、移动端单列卡片和底部四项导航已对齐。移动截图滚动到主配置动作区，能看到“测试连通性”“保存”和备用卡顶部。

逐项偏差记录见 `visual-diff.md`。

## 尚未关闭

- 发布级 migration rollback / 已有 volume 回退演练尚未执行；
- 旧 `auth.account_credentials` 明文凭证的双读单写兼容窗口仍需独立设计；
- fallback 专用审计事件尚未暴露为可查询记录；
- 当前状态保持 `READY_FOR_REVIEW`，不标记为发布级 `PASS`。
