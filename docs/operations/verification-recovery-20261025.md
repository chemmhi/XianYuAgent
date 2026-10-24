# 2026-10-25 验证恢复修复

生产排查确认：滑块并非没有执行。一次首轮 Ydisks 轨迹收到平台 `code=0`，但浏览器层还等待“离开验证 URL 且 x5sec 变化”，因此在约 180 秒后报 `XIANYU_VERIFICATION_TIMEOUT`。后续重试曾收到 `300,0` 并完成恢复。

修复后，自动滑块收到成功 verdict 且当前调用是原生 IM Token 请求时立即返回；浏览器仍必须在同一个 Chrome 会话中重新请求 Token，并校验新 Token、deviceId 和账号 userId。Token 与完整 Cookie 分区快照通过一次 production store upsert 落库后，API 才能创建/更新 IM 客户端。数据库写入失败会阻止恢复完成，旧凭证保留。

验证风险按账号保存可重放的只读请求上下文。商品详情接口风险保存 itemId；恢复会先用当前凭证复验该商品详情接口，再按 source、episode、开始时间和 risk revision 条件清除。旧版本没有上下文的风险只从同账号商品目录选择商品做同一只读接口复验。Token 或 IM 风险不会因商品详情成功被清除；未知风险保持 pending。

风险 revision 由 PostgreSQL 迁移 066 持久化，内存存储也生成相同的 CAS 标识。恢复开始读取 revision，凭证落库后只清理同一 revision；恢复期间新写入的同源风险会保留。浏览器恢复成功但原 API 复验仍失败时记录 `verification_recovery_pending`，不会记录 completed，也不会把页面状态伪装成已恢复。

验证证据：真实 Patchright/Chrome、受控 HTTP、真实 PostgreSQL 的原生恢复测试覆盖普通成功、签名 Cookie 过期、挑战后再次挑战、平台 code=0 但不跳转、code=0 但 Cookie 不变化、错误账号、缺 Token、挑战未解除和 code=300；9 项全部通过。风险复验和 Token 落库顺序测试覆盖内存与 PostgreSQL 12 项全部通过；IM 凭证、单 owner、HTTP 会话维护相关回归通过。真实生产只读复验曾返回商品详情 `SUCCESS`，本修复避免再次把“Token 已恢复”直接当作“所有来源风险已核销”。
