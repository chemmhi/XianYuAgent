# 授权弹窗按钮裁切与腾讯云自动登录排查（2026-11-09）

## 范围与验收

基线为本地及腾讯云生产 `89a2d348`。原工作区有大量既有删除，保持原样；本次使用独立分支 `codex/account-login-layout-20261109`。

正式 `/accounts` 的 `AccountLoginModal` 用固定 540px 高度容纳所有方式，后置样式将 `.account-login-body` 从 auto 改为 hidden，账密表单包含校验消息占位和已保存账密按钮时，底部提交按钮被裁切。改为非扫码表单随内容伸展、受动态视口高度限制，超出后表单内部滚动；登录方式选择器不参与压缩。扫码方式保留原固定高度。

模块边界：弹窗声明当前登录方式，账号 CSS 负责尺寸/滚动；扩展已有密码登录 Chrome/CDP 验收脚本，不修改登录服务、公开 API、数据库或凭证。

## 腾讯云只读结果

通过固定主机校验的 `tencent-server` SSH，在 `/home/ubuntu/xianyu-agent-prod` 查询 Git、API/Worker 日志与数据库只读事务，没有修改生产源码、数据、凭证或运行配置。

- 逐星智能在查询时为 connected / active，传输心跳持续更新，账密记录 enabled=true，调度时间约每 30 秒更新，无未过期密码登录租约。
- 密码登录会话：11 月 9 日 01:54:14 开始的一次会话停在 `verification_required / PASSWORD_SECURITY_VERIFICATION_REQUIRED`；11:46:20、11:46:46 开始的两次会话分别于 11:46:29、11:46:54 成功。
- 镜影映照为 expired，凭证 expired，但没有 `account_login_secrets` 记录，无法使用保存账密恢复；旧 transport=connected 的时间为 11 月 7 日，不能当作新鲜在线证据。
- 以上均为 Asia/Shanghai 时间。数据库会话没有 automatic 标志，不能仅凭会话时间证明某次一定由后台而非手动发起；后台调度正在运行由账密调度行持续更新支持。

## 为什么安全验证后看起来没有继续登录

`PasswordReloginWorker` 只扫描已启用且到期的保存账密。`PasswordLoginService.run` 捕获不能由当前 HTTP 链路继续处理的 `PasswordHttpVerificationRequired` 时，保存安全验证状态，并对自动任务禁用后续自动重试；finally 标记任务 finished。`pending()` 只返回未 finished 的自动验证任务，所以这类已经退出的安全验证不会由页面自动弹窗呈现。

历史会话的 failure_code 与这一代码分支相符，但没有保留完整挑战详情、当时 enabled 状态或自动/手动来源；本次不推断具体挑战 URL、类型或平台触发原因。当前已经成功的账号没有重新发起真实登录或强制制造过期。

现有“使用已保存账密登录”是显式重新启用暂停记录的入口，不要求重新填写密码；没有保存账密的账号需先成功使用账号密码授权。未修改重试策略，不承诺平台要求的安全验证可无人值守完成。

## 验证与证据

- 修复前新增 Chrome 回归真实失败：`password-form overflowing form can be scrolled 1440x572`。
- `npm run build:web`：类型检查和生产构建通过，保留现有大 chunk 提示。
- `npm --workspace apps/web run test`：115 文件、591 测试通过。
- `npm --workspace apps/api run test:password-login`：67 测试通过，包括过期自动恢复、Cookie 预检查、安全验证、停用和并发租约。
- `PASSWORD_LOGIN_TEST_DATABASE_URL=... npm --workspace apps/api run test:password-login:postgres`：独立本地 PostgreSQL，1 项通过。
- `PASSWORD_LOGIN_TEST_DATABASE_URL=... PASSWORD_LOGIN_E2E_VERIFICATION=true node --import tsx apps/api/scripts/password-login-e2e.mjs`：真实产品 DOM → API → 独立 PostgreSQL → DOM，以及重启恢复；平台边界为本地 HTTP 契约夹具。首次提交和保存账密重试通过 CDP 鼠标事件点击，不能用程序 click 绕过遮挡。
- 新增/已有账号两种表单各覆盖 1440×900、1440×572、920×572、858×572、390×844、390×572：滚动可用、弹窗不出视口、按钮上下边界可命中。截图在临时目录 `xianyu-password-login-evidence`，不提交。
- `git diff --check` 通过。临时 PostgreSQL 容器仅用于本次测试，验收后移除。

未执行生产新挑战、长期无人值守续期或生产发布，不把受控平台夹具当作真实闲鱼验收。回滚为还原本次弹窗/CSS 与测试差异，没有数据库迁移。功能分支提交后等待仓库要求的人工审核；用户指定的本地合入 main 再 push 顺序优先于磁盘旧 PR-only 规则。
