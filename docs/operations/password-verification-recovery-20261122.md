# 腾讯云密码登录验证续接与单按钮修复（2026-11-22）

## 目标和范围

用户要求先排查腾讯云“需要验证但没有可用验证码”的真实原因，修复密码登录，并将两个入口统一为“登录并恢复授权”：预填已保存账号，空密码复用保存密码，非空密码使用新输入。只在授权成功后更新保存的密码，不回显密码或密文。本次无数据库迁移。

## 真实生产证据

- 腾讯云运行 `7c5fe60`，API/Worker/基础设施运行中。11 月 22 日 09:31 的两次密码会话均记录 PASSWORD_VERIFICATION_UNAVAILABLE；已保存记录被暂停，不能靠改账号状态制造恢复。
- 使用当前保存账密做两次受控 HTTP 诊断，持账号租约并复用官方设备 SDK。只输出响应枚举、结构、路径和错误码，密码、Cookie、Token、动态链接值未输出或提交；没有写回账号凭证或开启自动重试。
- 官方响应为 content.success=true、resultCode=100、loginResult=success、loginSucResultAction=loginResult、dialogAction=keepLoginConfirm；feedbackPayload.dynamicUrl 给出官方 login_token/login.do 的后续地址。旧代码把中间态当成完整登录，跳过确认 POST，随后的 loginuser MTOP 返回 FAIL_SYS_ILLEGAL_ACCESS 且没有验证 URL，服务因此落入不可续接的失败分支。
- 已有官方 havana-nlogin 0.10.38 脚本说明 keepLoginConfirm 的超时/关闭默认路径会调用 keepLoginSubmit(defaultUrl)，该函数用 reqPost 提交空表单并重新处理返回的登录结果。本次按该默认动作续接，不选择增加记住登录权限的分支。
- 另一个可复现缺陷：通用验证解析器忽略 content.data 的嵌套/相对地址，ret 提示验证时先抛无 URL 异常，导致真正的 IV 地址丢失。

## 实现边界

- password-login-continuation.ts 只支持已取证的 keepLoginConfirm，严格限制 HTTPS passport.goofish.com/login_token/login.do 和有效 token；拒绝其他非空 dialogAction、越域、循环和超限，避免借旧 Cookie 把未完成登录当成成功。
- 同一 SDK、Cookie jar 和业务任务执行密码 POST→默认确认 POST→原生挑战或 IV→身份/IM token；原生验证只重试被拦截的当前 POST，不重交密码或重新初始化一次性 IV。
- 验证解析保留受信任的响应基准地址，识别嵌套地址；只有实际可续接的挑战才打开验证弹窗。其余官方验证方式不伪造 URL 或自动解题。
- 保存信息 GET 只向当前有 manage 权限的用户返回 available/loginId；前端迟到的预填响应不覆盖用户编辑。空密码重试同时提交预期 loginId，后台再次检查，变更账号后不能静默复用旧密码。
- 表单仅一个主按钮；密码不回填、不 trim，输入新密码走正常登录，成功后才更新保存记录。原有协议勾选、租约、generation、取消和删除保护保留。

## 验证和评审

- 回归旧版：确认续接、确认阶段验证码、嵌套相对 IV 等新增用例在原代码失败，原有 11 项 IV 场景通过；修复后密码/HTTP/IV/SDK 专项 76/76 通过。
- 独立 PostgreSQL 专项 1/1 通过。真实 Chrome/CDP→正式 React/API→独立 PG→页面 E2E 通过：确认后二维码、空密码恢复、修改账号空密码拒绝、同按钮新密码更新、页面导航与重启恢复。外部平台是明确的本地契约夹具，不能替代生产官方验证验收。
- Web 全量 592 项和完整 API 测试通过；双端 typecheck/build 通过。错误文案映射另增加 3 项测试。差异门禁无行尾空白。
- 两轮独立复核修正两项 P2：不实现未经取证的其他 dialog POST 参数；未知非空 dialogAction 立即拒绝。复审及独立 76 项通过，无剩余 P0–P2。
- 桌面 1440×900、移动 390×844 及 12 种表单/窗口组合截图与控件可见性检查通过。截图、夹具、生产私有诊断不提交。

## 发布与回滚

按 PR-only 合入 main，再使用腾讯云既有统一部署入口。稳定加密密钥、设备目录和数据库均保留；不导入本地验收凭证。回滚通过 revert PR 恢复本次代码，无需逆向迁移。生产验证码仍由用户按官方提示完成；实际发布及真实挑战续接结果另据现场记录，本文不提前声称生产账号已恢复。
