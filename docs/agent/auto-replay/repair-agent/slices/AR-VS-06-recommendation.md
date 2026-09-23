# AR-VS-06：店内推荐

## 状态

- 状态：IN_PROGRESS
- 代码：`apps/api/src/auto-reply-recommendation.ts`
- 测试：`apps/api/scripts/auto-reply-recommendation.test.ts`

## 固定边界

- 推荐资格由版本化配置决定，模型只负责候选排序或表达，不得自行扩大候选集。
- 售后未解决、澄清等待、负面情绪和超强情绪均可由策略门控；默认不强推。
- 候选必须同账号、库存可用、事实新鲜且不在冷却期；一次最多输出配置上限（1–3 个）。
- 无候选时返回 `NO_CANDIDATE`，不能伪造商品或转人工。

## 验收证据

- 覆盖同账号/跨账号、库存、新鲜度、冷却、偏好匹配、负面情绪与 awaiting_user 门控。
- `npm --workspace apps/api exec -- node --import tsx --test scripts/auto-reply-recommendation.test.ts`
- `npm --workspace apps/api run build`

## 回滚

关闭 recommendationAllowed 读取或停止调用推荐器，保留主目标回答与澄清链路。
