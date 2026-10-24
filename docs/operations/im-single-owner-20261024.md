# 同账号 IM 由 API 持有

## 原因与执行路径

生产出现卡券图片成功、文字结果未知，API 和 worker 的同账号 socket 随后交替关闭（1006）。两个进程读取相同 Token/deviceId，各自创建 IM 客户端，会争用同一会话。1006 本身不包含平台踢线原因，不能单凭它断言平台机制；双进程各自连同账号的架构问题需要消除。

当前 compose 采用一个 API 实例作为 IM owner。worker 的发送、会话读取、已读、历史补拉、连接检查及重置，通过内部 HTTP 交给 API。API 继续执行既有发送回执核验、会话锁、消息落库及凭证恢复逻辑。worker 的私有 `ensureClient` 硬性禁止建立本地连接，API 不可用时返回错误。部分发货恢复 CLI 也通过 API 核验图片历史。

本方案对应单 API 实例部署，未实现多个 API 副本之间的 owner 选举。扩容 API 前需另行实现账号所有权分配，不能直接复制实例。

## 配置

- API、worker 和维护 CLI 使用相同的 `CREDENTIAL_ENCRYPTION_KEY`，至少 32 个字符且不能使用内置开发默认值。该值通过独立 HMAC 派生用于内部请求鉴权，不传输密钥本身。
- compose 的 worker 设置 `XIANYU_IM_OWNER_URL=http://api:8080`。
- 本地 `dev:worker` 默认连接 `http://127.0.0.1:${PORT}`；两个进程均需加载同一随机密钥。更换已有凭证加密密钥会影响原加密数据，不要为本功能随意轮换生产密钥。
- 请求携带时间戳、随机 nonce 和正文签名；API 检查有效期、防重放和账号范围。请求大小最多 15 MiB，兼容原有 10 MiB 图片限制，不记录卡券正文或凭证。

## 回执与重复发送保护

发送按账号、方法及原请求 ID 在 PostgreSQL 记录幂等结果。指纹不含 traceId，重试可复用已保存的最小回执；正文变更会冲突。客户端不自动重发。

服务明确标记会话/连接/图片上传准备、锁获取失败等尚未发送的错误，允许原请求恢复。已经进入外发后发生的未知错误保留持久防重记录；锁释放失败也不会视为尚未发送。丢失 HTTP 回执时返回 `XIANYU_IM_SEND_OUTCOME_UNKNOWN`，原有发货步骤和卡券隔离机制继续阻止重发及确认发货。进程崩溃后遗留的 processing 记录也按未知处理。

## 验证

`npm --workspace apps/api run test:xianyu-im-owner`：9 项真实 HTTP 专项，包括鉴权、重放、账号范围、二进制图片、不同 trace 的去重、准备阶段恢复、真实 service 的获取锁与释放锁异常、未知结果保护、worker 无本地 socket。

`IM_OWNER_TEST_DATABASE_URL=postgres://...@127.0.0.1:54946/xianyu_im_owner_test npm --workspace apps/api run test:xianyu-im-owner:postgres`：先在隔离 PostgreSQL 执行现有迁移；测试只接受 localhost/127.0.0.1 且数据库名为 `xianyu_im_owner_test`。

多进程测试实际启动 API 和两个 worker OS 进程、真实本地 WebSocket 网关、真实 PostgreSQL，执行图片→文字→发货。断言只注册一个 socket、worker 无本地客户端、消息回执落库；另一 worker 不重复发货；丢失文字 HTTP 回执后订单进入人工核对且卡券隔离；重启 owner 后仍能读取旧回执而不再次发送。测试平台网关与 MTOP 为受控替身，没有向真实买家发送消息。

相关凭证、即时风险恢复、HTTP 会话维护 47 项回归通过；网关、回执核对、outbox、发货 guard、自动化完整流程及平台适配器 49 项通过；API 编译、compose 检查通过。独立 agent 审核发现的问题已修正并复核，另补真实 service 锁阶段测试。

仓库旧 `product-automation-coupon-delivery-e2e.test.ts` 共 20 项，其中 19 项失败，模拟 MTOP 缺失 `fetchOrderCandidates`；已用修改前 HEAD 的独立源码快照复现，属于已有测试夹具与现有平台事实核验逻辑不匹配。此次未修改该夹具或生产平台核验条件。上述新增多进程测试覆盖本次图片/文字/发货真实代码链路。

## 上线核验

推送 main 走现有自动部署。核验容器版本、worker owner URL、共享密钥可用性、API 连接和双进程关闭日志。只读观察真实后续订单，不补发用户已手动完成的订单；本地受控成功不能代替真实新订单交付证据。
