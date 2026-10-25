# 邀请码与认证反馈复核（2026-10-25）

本次补充修复：启用/禁用动作路径、统一数字输入控件、续期独立弹窗、认证及邀请码接口失败右下角 Toast、字段局部校验和生成工具栏对齐。

## 实际执行

- `npm --workspace apps/web run test`：98 文件、436 项通过。
- `npm run typecheck` 与 `npm run build`：API/Web 通过；后续纯前端修正再次运行 `npm run typecheck:web`、`npm run build:web` 通过。构建保留已有 bundle 大小提示。
- `node --import tsx --test apps/api/scripts/invite-registration/*.test.mjs`：内存/PostgreSQL 共18项通过，包含注册竞争、用户隔离、共享账号保护与删除依赖清理。
- 真实内置浏览器访问 `http://127.0.0.1:18081/settings`，连接专用 PostgreSQL 测试库。通过页面生成邀请码、注册、登录、禁用/启用、修改续期天数并刷新核对日期。SQL核实注册用户角色为 user、邀请码激活且到期日期已持久化。
- 续期弹窗：0天字段错误，无全局Toast；取消不写入；30天成功后关闭并更新日期。并发激活使用测试HTTP接口制造真实409，续期失败后保留弹窗、右下Toast；重试可用、不叠加Toast。
- 密码不一致：错误贴确认密码字段，聚焦该字段，卡片高度均699.328125px；无效邀请码接口错误：右下Toast，表单内alert为0。
- Toast隔离：真实409业务Toast为1条，立即退出后0条，登录另一用户后仍0条，普通用户无邀请码管理入口。认证专属Provider使用独立key；业务Provider随退出销毁，旧异步闭包不能投递到新会话。
- 工具栏：输入和按钮顶部均167.875px、高度均34px，中心差0；生成字段校验前后工具栏高度均52.484375px。续期字段错误前后弹窗高度均362.640625px。
- 独立agent `/root/status_route_review` 审核各切片，发现并推动修复Provider跨登录残留风险后最终PASS；复核了截图和相关测试。

## 范围与限制

这组证据验证本次新增认证/邀请码交互，不代表全站所有历史错误展示均已迁移。未重新执行全部API/全站E2E，也未用真实闲鱼凭证验证外部平台业务。数据库中的账号均为临时测试账号，没有创建生产邀请码或写入生产业务数据。

截图为实际页面，桌面1440×900、移动390×844。`register-field-error-desktop.png`展示字段错误；`register-api-error-toast-desktop.png`与`renew-api-error-toast-desktop.png`展示接口错误；`invite-toolbar-aligned-desktop.png`展示工具栏对齐。

设计参考：
- https://ant.design/docs/spec/feedback/
- https://m1.material.io/components/text-fields.html

旧版截图可能保留早期错误布局；以本目录最终证据为准。生产部署结果另以GitHub Actions对应SHA及线上复核为准。
