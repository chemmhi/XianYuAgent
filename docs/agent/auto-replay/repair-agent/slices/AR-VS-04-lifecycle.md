# AR-VS-04：生命周期引导

## 状态

- 状态：IN_PROGRESS
- 代码：`apps/api/src/auto-reply-lifecycle.ts`
- 测试：`apps/api/scripts/auto-reply-lifecycle.test.ts`

## 固定边界

- `observedStage` 只能来自账号范围内的订单/支付/物流/售后事实；文案不能把目标阶段写成已完成。
- 路由动作来自版本化 `LifecyclePolicy` 规则，模块不内置订单阶段分支或默认 handoff。
- 多订单同时命中时返回配置化 `ambiguity.nextAction`，不猜测订单。
- 非当前账号事实 fail-closed；缺少策略也 fail-closed。
- 本切片只生成引导计划，不执行付款、发货、改价、退款等写操作。

## 验收证据

- 覆盖未付款、已付款待发货、售后优先级、已选订单消歧、跨账号隔离和缺少策略。
- `npm --workspace apps/api exec -- node --import tsx --test scripts/auto-reply-lifecycle.test.ts`
- `npm --workspace apps/api run build`

## 回滚

停止调用生命周期投影器，保留原有事实读取和安全回答；不删除已生成的证据摘要。
