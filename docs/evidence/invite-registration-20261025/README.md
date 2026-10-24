# 邀请码注册与设置页视觉验收

日期：2026-10-25（Asia/Shanghai）

验收入口：npm --workspace apps/web run test:e2e:chrome:settings

环境：真实 Chrome Headless、Vite live 前端、Node API memory storage；桌面 viewport 1440×900，移动 viewport 390×844。脚本同时通过真实 API 创建管理员、创建邀请码、清除会话进入登录页、打开注册页并提交邀请码注册，再回到管理员设置页验证邀请码面板。

## 登录页

![登录页桌面](/E:/OpenAI/Codex/home/worktrees/invite-registration-20261025/XianYuAgent/docs/evidence/invite-registration-20261025/screenshots/auth-login-desktop-1440x900.png)

![登录页移动端](/E:/OpenAI/Codex/home/worktrees/invite-registration-20261025/XianYuAgent/docs/evidence/invite-registration-20261025/screenshots/auth-login-mobile-390x844.png)

登录页显示“没有账号？去注册”入口，桌面和移动端均未出现溢出。

## 注册页

![注册页桌面](/E:/OpenAI/Codex/home/worktrees/invite-registration-20261025/XianYuAgent/docs/evidence/invite-registration-20261025/screenshots/auth-register-desktop-1440x900.png)

![注册页移动端](/E:/OpenAI/Codex/home/worktrees/invite-registration-20261025/XianYuAgent/docs/evidence/invite-registration-20261025/screenshots/auth-register-mobile-390x844.png)

注册页包含邀请码、昵称、邮箱、密码和确认密码字段，并提供返回登录。

## 管理员设置页

![邀请码设置桌面](/E:/OpenAI/Codex/home/worktrees/invite-registration-20261025/XianYuAgent/docs/evidence/invite-registration-20261025/screenshots/settings-invite-desktop-1440x900.png)

![邀请码设置移动端](/E:/OpenAI/Codex/home/worktrees/invite-registration-20261025/XianYuAgent/docs/evidence/invite-registration-20261025/screenshots/settings-invite-mobile-390x844.png)

管理员设置页只显示自动回复、模型和邀请码分类；凭证管理、安全输出校验、Outbox Worker、插件配置均已移除。邀请码表格展示完整码、状态、到期时间、激活账号和操作列；操作列包含启用/禁用、续期、删除。激活邀请码删除前需要两次确认，确认后清理激活用户数据。移动端表格在卡片内横向滚动，底部导航与内容卡片均在 viewport 内。

其他自动回复状态截图位于同目录，作为设置页已有功能的回归证据。
