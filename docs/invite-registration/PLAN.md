# 邀请码注册：分片计划与验收

日期：2026-10-25（Asia/Shanghai）。用户要求逐功能实现、每次独立 agent 审核后再提交。

## 修改前检查
现有 React/Vite Web + Node/TypeScript API，PostgreSQL Store 与 MemoryStore；认证在 services.ts、app.ts、auth/*；设置在 SettingsPage.tsx。auth.admins 支持多用户，但 bootstrap 只创建首个管理员；业务账号权限已有 account_scopes。沿用现有 auth session/CSRF、API envelope、Vitest/node:test 和 Chrome E2E。主工作区 docs/agent-worktree-registry.md 的既有修改保留。

## 权限与数据契约
旧用户保持 role=admin，邀请码注册强制 role=user。平台管理员仅管理邀请码，不因此获得其他用户的闲鱼账号权限。注册不复制邀请人的 scopes、配置、凭证、工作区或 Skill。新用户只能绑定及访问自己授权的闲鱼账号。跨用户同一闲鱼身份不自动转移或共享。
邀请码为随机32字节 base64url，单次有效，默认7天、可选1至30天。数据库只存 SHA256、显示前缀；创建响应仅一次返回明文，列表不回显；管理员可撤销。邀请消费、创建用户与登录session同一事务，邮箱重复及持久化异常回滚消费。注册后直接进入已登录界面。不会接受客户端role/adminId/scope赋权。
普通用户不能执行主机 Skill（含 HTTP 和模型间接调用），以免继承服务端环境/主机权限。旧管理员能力兼容。

## 串行切片
S1 用户隔离与角色保护：角色输入仅内部store；封闭跨用户幂等重放；Skill权限在服务边界核对；按双用户实际HTTP测试保护业务账号与已有功能。新增业务不得在此切片开启注册。
S2 邀请码管理：迁移、独立service/repository/HTTP模块、设置邀请码panel；移除截图四个tab，保留自动回复及模型配置。仅admin可见并由API强制校验。先独立单元/PG/API/浏览器验证、两轮审核，再提交。
S3 注册：原子消费邀请码+user+session；登录页去注册、注册字段（昵称/邮箱/密码/确认密码/邀请码）及返回登录；错误/加载/重复提交状态；真实浏览器→API→隔离PostgreSQL端到端，完整回归、两轮审核，再提交。

## 设计与门禁
不新增视觉体系，沿用现有 card/InputField/Button/token。desktop 1440x900、mobile 390x844；管理员无闲鱼账号时也能生成邀请码；普通用户看不到邀请码分类；注册错误保留输入并可重试。测试覆盖失效/撤销/重复/并发邀请码、重复邮箱回滚、角色提升拒绝、跨用户读写/幂等/WS/会话/配置、旧登录/退出/初始化和自动回复设置、模型设置。
每片要求类型检查、相关单元、真实PG/API集成及适用浏览器功能/视觉验证；独立审核至少两轮，所有P0-P2闭环。记录命令和结果后中文Conventional Commit。测试使用独立本地PG数据库，不连接服务器、不执行真实闲鱼写操作。远程部署不在本次范围。

## 模块与回滚
S1 保留原模块边界，小范围修复权限。邀请码持久化和规则独立模块，不扩展大型store文件内的无关逻辑。Web注册和邀请码panel独立模块。迁移新增表向前兼容；回滚时先关闭注册/回退应用，保留新增用户（旧版仍能登录），不自动删表或删用户；记录已消费邀请不补发。完整schema重放及并发事务验证在专用数据库执行。

## 评审与风险
设计审核：进行中（isolation_review）。风险：共享主机Skill、幂等缓存、闲鱼身份恢复、模型自定义URL可能访问内网。必要限制在开放注册前完成。生产外部闲鱼/API/邮件服务不作为测试依赖。

## 设计审核补充决策
D2-P1-01：普通用户模型地址仅允许管理员通过 INVITED_USER_MODEL_ORIGINS 配置的受信任 HTTPS origin（默认 https://api.openai.com）；覆盖save/test/list/resolve及probe，普通用户fetch禁止重定向，运行时也校验metadata。普通用户不会回退使用服务器共享模型凭证。保留旧管理员现有自定义地址能力。扩展origin属于管理员信任配置，不由普通用户指定。
D2-P1-02：邀请码创建不用通用幂等响应缓存，表内以(created_by,request_key)唯一约束防重复；重复key返回409并提示重新生成，DB及审计只存hash/前缀/ID，不保留明文。
D2-P2-03：注册不缓存公共会话结果，成功响应丢失后重试提示邀请码已用，可凭刚设置的邮箱密码登录。重复邮箱与session写入失败均在同一事务回滚邀请码消费。
R1-P1-003：普通用户重授权Cookie必须匹配当前账号身份；跨账号身份冲突在写凭证前拒绝。旧管理员仍可换绑未被占用身份。MemoryStore保持与Postgres全局身份唯一约束一致。
设计第一轮 isolation_review PASS（修复项在S1实施）；第二轮补充决策待复审。
