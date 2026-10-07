# Model Provider 主备切换 v2

## 1. 目标

解决主 Provider 持续故障时每个业务请求都重复等待主 Provider 超时，导致自动回复、Workspace、商品文案和知识库任务整体变慢。

同时满足：

- OpenAI API 兼容模型配置页显示当前生效 Provider。
- 支持自动路由、手动优先主、手动优先备三种模式。
- 主备故障可熔断、冷却、半开探测并自动恢复。
- API、Worker、多副本之间保持路由与熔断状态的一致边界。
- 新配置即时影响新请求，旧 in-flight 请求允许完成。
- 全链路可审计、可观测、可验收、可回滚。

> 实现补充（2026-10-07）：V2 由 `MODEL_PROVIDER_FAILOVER_V2` 控制，默认开启；关闭时回退到 legacy `ModelClientService` 路径。Provider 配置保存会推进账号级单调 `config_generation`，探针拥有独立 `probe_timeout_ms`。

## 2. 现状根因

当前 `ModelClientService` 只在单次请求内执行 `primary -> backup`。下一次请求仍然先调用 primary；账号 resolver 还会重新创建 service，因此 service 内状态无法跨请求复用。

新实现必须把 Provider 路由状态放到账号级 `ModelClientPool`，并将运行时 routing decision 与 provider health 分离：

- routing decision：每个新请求从 authoritative store 读取，不使用本地 TTL 旧值。
- provider client：可在本地缓存，按 config id/version/generation 校验。
- provider health：按 provider 独立维护 CLOSED/OPEN/HALF_OPEN。

## 3. 路由模式

### 3.1 模式

```text
auto
manual_primary
manual_backup
```

手动模式只改变运行时首选，不改变两张配置卡的 `role` 标签；配置页面仍固定显示主配置和备用配置。

### 3.2 effective provider 定义

`effective_provider` 表示“下一次新请求根据最新 routing mode + 最新 provider health 计算出的首选 Provider”。

`last_successful_provider` 单独表示最近一次成功返回结果的 Provider，避免把手动偏好、临时 fallback 和实际最近成功者混为一谈。

双 Provider 都为 OPEN 时：

```json
{ "effective_provider": null, "effective_role": "none" }
```

### 3.3 自动模式

- 主 CLOSED：下一次请求走主。
- 主 OPEN、备 CLOSED：下一次请求走备。
- 主 CLOSED、备 OPEN：下一次请求走主。
- 主备都 OPEN：业务请求快速返回 503，并异步触发 due provider 的 safeProbe。

### 3.4 手动模式

- `manual_primary`：主为首选；主 OPEN 时默认快速绕过到备。
- `manual_backup`：备为首选；备 OPEN 时默认快速绕过到主。
- 手动偏好持续保留，不因一次 fallback 清除。
- `forceProbe=true` 只允许 safeProbe，不允许绕过 OPEN 状态重放业务 completion。
- 切回 `auto` 后恢复自动熔断路由。

## 4. Provider 熔断状态

每个 Provider 独立维护：

```text
state: CLOSED | OPEN | HALF_OPEN
failure_count
cooldown_until
next_probe_at
generation
last_transition_reason
lease_token
```

状态转换：

```text
CLOSED --硬故障--> OPEN
OPEN --到达 next_probe_at--> HALF_OPEN
HALF_OPEN --safeProbe 成功--> CLOSED
HALF_OPEN --safeProbe 失败--> OPEN
```

默认参数：

```text
首次硬故障：立即 OPEN
初始冷却：60 秒
连续探测失败：60s -> 120s -> 300s -> 600s
最大冷却：10 分钟
冷却抖动：由 0 到 10% 随机抖动
探针 lease TTL：probe_timeout + jitter + 5 秒
```

401/403 默认长熔断，直到对应 config version/generation 变化；`forceProbe` 只运行 safeProbe。

429 使用 `Retry-After`，并裁剪到 1 秒至 1 小时；没有该字段时使用默认冷却。

## 5. 故障分类

### 5.1 硬故障：fallback + 熔断

- `MODEL_TIMEOUT`
- `MODEL_NETWORK_ERROR`
- `MODEL_INVALID_RESPONSE`
- HTTP 401、403、408、429、5xx
- 流式协议错误，且尚未产生任何 text/reasoning/tool-call 输出

### 5.2 请求或业务故障：不 fallback、不熔断

- HTTP 400、404、422（具体策略可按 Provider 配置）
- `MODEL_ABORTED`
- `MODEL_TOOL_LOOP_EXCEEDED`
- `MODEL_UNSUPPORTED_TOOL`

### 5.3 部分流和工具调用

一旦主 Provider 已产生任意可见输出、reasoning delta、tool-call delta 或 tool call：

- 禁止把同一用户请求重放到备用。
- 原请求结束并记录 Provider 故障。
- 由上层按现有任务状态机处理未完成结果。

## 6. 单请求时限

ModelClientService 为每次请求建立 overall deadline，默认 60 秒。主、备共享同一剩余预算：

```text
remaining = overall_deadline - now
primary_timeout = min(primary_config_timeout, remaining)
backup_timeout = min(backup_config_timeout, remaining_after_primary)
```

同一请求每个 Provider 最多尝试一次；剩余预算耗尽时直接返回，不再串行等待第二个完整 timeout。

## 7. safeProbe

半开和后台恢复禁止重放用户请求。每个 Provider 支持配置：

```text
probe_strategy: models | completion | health_url | none
probe_timeout_ms
probe_url
probe_model
```

策略语义：

- `models`：GET provider `/models`，HTTP 2xx 且目标 model 存在才成功。
- `completion`：发送固定、无用户消息、无 tools 的最小 probe prompt；只验证响应协议。
- `health_url`：仅访问配置白名单 host 的健康检查 URL，HTTP 2xx 成功。
- `none`：不自动半开，只能通过手动测试或配置变更恢复。

`/models` 返回 404/405 或 Provider 明确不支持时，结果标记为 `PROBE_UNSUPPORTED`，保持 OPEN，不把探针不支持误判为 Provider 故障。

`/models`、`completion` 或 `health_url` 返回 401/403 时，结果标记为 `PROBE_AUTH_FAILED`，进入 manual-only 长熔断；只有配置变更或显式 `forceProbe` 成功后才恢复 CLOSED。

## 8. ModelClientPool 与配置 generation

Pool key：

```text
adminId
accountId
primaryConfigId/version
backupConfigId/version
routing_version
config_generation
```

Provider 配置更新、凭证轮换推进账号级 `config_generation`；routing mode 变更推进独立的 `routing_version`，不重建 Provider generation：

- 一个 OpenAI Provider 保存（即使同时更新元数据并轮换密钥）只推进一次 generation；直接调用独立 credential mutation API 时，每个成功 mutation 各自推进一次。

- 新请求读取新快照。
- routing version 变化会在下一次 `resolve` 时更新本地 routing decision，但不清空 breaker 健康快照。
- 旧 in-flight 请求允许完成。
- 旧 generation 的失败不得污染新 generation 的 breaker；写入必须带 generation CAS/fencing。
- 旧 generation 的 due probe、lease、probe 结果全部丢弃。

本地只缓存 transport/client 和健康快照；手动 routing decision 不进入本地 TTL cache。

## 9. 持久化与多进程一致性

新增 account-scoped routing record：

```text
account_id
mode
preferred_role
routing_version
config_generation
updated_by
updated_at
```

手动切换写入流程：

1. Store/PostgreSQL 乐观锁校验 `expectedVersion`。
2. 持久化 routing record，并以该提交作为正确性边界。
3. 尝试同步更新 Redis 镜像；Redis 镜像写入是 best effort，不阻塞已提交配置的生效。
4. Store 提交成功后返回 `200`；若 Redis 镜像同步失败，响应标记 `routing_mirror=degraded` 并记录修复事件。
5. 新请求以 Store/PostgreSQL 的 committed routing record 为权威；Redis 只做镜像读取与修复提示，Redis 版本更高也不得覆盖 Store。

Redis pubsub 只负责 cache invalidation/唤醒，不承担正确性。

当 Store 与 Redis 镜像版本不一致时，丢弃镜像偏好并异步回写 Store 记录；Store 读取失败时不使用可读但未验证的 Redis 镜像。

Redis 与 Store 同时不可用时：

- 返回 `MODEL_ROUTING_STATE_UNAVAILABLE`。
- 不复用旧手动偏好。
- 返回 `trace_id`，并记录观测事件。

Redis 不可用时的本地 breaker 只提供单进程保证，必须产生降级事件；Redis 恢复后重新对账。

## 10. Probe Scheduler

API 与 Worker 各启动一个 `ModelProviderProbeScheduler`，每 5 秒扫描 due probe。

Redis 结构：

```text
sorted set: model:probe:due
score: next_probe_at
lease key: model:probe:lease:{accountId}:{provider}:{config_generation}
```

规则：

- Redis SETNX/CAS + lease_token 保证同一 account/provider/generation 单飞。
- 只有持有相同 token 的进程可以释放 lease。
- lease TTL 覆盖 probe timeout、抖动和额外 5 秒。
- 进程重启后 scheduler 重新扫描 due set。
- 无业务流量时也能自动恢复。
- 两边 OPEN 时业务请求立即 503，scheduler 独立探测最早 due Provider。

## 11. API 契约

### 11.1 GET

`GET /api/v1/settings/openai`

除现有 `items` 外返回 `runtime`：

```json
{
  "mode": "auto|manual_primary|manual_backup",
  "preferred_provider": { "role": "primary|backup", "id": "...", "provider": "...", "model": "..." },
  "effective_provider": { "role": "primary|backup", "id": "...", "provider": "...", "model": "..." },
  "last_successful_provider": { "role": "primary|backup", "id": "...", "provider": "...", "model": "..." },
  "last_served_at": "...",
  "observed_at": "...",
  "provider_states": {},
  "cooldown_until": "...",
  "next_probe_at": "...",
  "last_transition_reason": "...",
  "config_generation": 1,
  "routing_version": 1,
  "server_time": "..."
}
```

### 11.2 手动切换

`POST /api/v1/settings/openai/routing`

请求体：

```json
{
  "accountId": "...",
  "mode": "auto|manual_primary|manual_backup",
  "preferredRole": "primary|backup|null",
  "forceProbe": false,
  "expectedVersion": 1
}
```

要求：

- 必须有 `Idempotency-Key`。
- 通过当前 Settings 管理员账号范围校验。
- 乐观锁冲突返回 409。
- 返回最新 runtime snapshot。
- 选择 OPEN Provider 时页面显示风险确认；确认后仍遵循快速绕过规则。

## 12. UI 行为

OpenAI API 兼容模型配置页面展示：

- 当前生效 Provider：下一次请求首选 Provider。
- 最近一次成功 Provider：实际最近成功的 Provider。
- 自动模式 / 手动优先主 / 手动优先备。
- 主、备各自 CLOSED/OPEN/HALF_OPEN 状态。
- 熔断剩余时间和下次探测时间，以 `server_time` 计算倒计时。
- “切换到主”“切换到备”“恢复自动模式”按钮。
- 切到 OPEN Provider 时显示风险确认和快速回退说明。
- 当前 Provider 为 `none` 时显示“双 Provider 暂不可用”，不展示过期 Provider 作为生效值。

## 13. 审计与监控

事件：

```text
model_provider.failover
model_provider.circuit_open
model_provider.circuit_half_open
model_provider.circuit_closed
model_provider.fast_fail
model_provider.probe_unsupported
model_provider.probe_failed
model_provider.manual_override_changed
model_provider.config_generation_changed
model_provider.routing_state_unavailable
```

字段：

```text
actor_id
account_id
previous/new mode
previous/new provider
provider role
config_version
routing_version
config_generation
reason/source
result
error_code
http_status
cooldown_until
trace_id
latency_ms
```

密钥只保留脱敏摘要。

## 14. 验收标准

### 路由与熔断

- 主成功只调用主。
- 主首次硬故障：本次切备，下一次直接走备，不再等待主 timeout。
- 主持续故障：后续请求不重复触发主超时。
- 冷却后只允许一个 safeProbe。
- 探测成功恢复主；探测失败退避。
- 双 OPEN 时 effective provider 为 null，业务请求快速 503，后台仍能恢复任一 Provider。

### 安全重试边界

- partial stream、reasoning、tool-call 后禁止 fallback 重放。
- 用户取消、400/422、工具循环错误不熔断、不 fallback。
- 主备共享 overall deadline。
- 每个 Provider 每次请求最多一次。

### 手动切换与页面

- 手动主/备切换持久化、幂等、乐观锁、即时影响第一笔新请求并写审计。
- 手动偏好与 effective provider、last successful provider 分开展示。
- OPEN Provider 手动选择支持风险确认和 forceProbe 仅探针语义。
- server-time 倒计时、状态、冷却和下次探测正确展示。

### 一致性与恢复

- API/Worker/多副本路由状态一致。
- Redis 断连、恢复、pubsub 丢失、lease 过期、进程重启均有测试。
- 配置更新中旧 in-flight 不污染新 generation。
- safeProbe 的 models/completion/health_url/none、PROBE_UNSUPPORTED、PROBE_AUTH_FAILED 均有测试。
- 无业务流量时双 OPEN 可自动恢复。

## 15. 实施顺序与回滚

1. 先落地类型、状态机、失败分类和单请求 deadline。
2. 再落地 ModelClientPool、routing record、API/Worker cache 边界。
3. 再落地 Redis breaker、lease 和 Probe Scheduler。
4. 再接入 Settings API 与前端状态展示/手动切换。
5. 最后运行单测、集成测试、API/Worker 多进程验证和浏览器验收。

回滚：

- 以 feature flag 保留 legacy one-shot fallback。
- 关闭 v2 路由后，新请求回到 legacy；已存在的 routing record 保留，不删除配置。
- 熔断/探针状态只影响路由，不修改 Provider 配置和密钥。
