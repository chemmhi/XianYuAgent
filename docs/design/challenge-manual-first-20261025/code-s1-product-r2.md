# S1 原浏览器远程交互：独立产品代码复审 R2

日期：2026-10-26（Asia/Shanghai）。
对象：修订后的 `apps/api/src/verification-remote-browser.ts` 与 `apps/api/scripts/verification-remote-browser.test.ts`。
范围：复核 PR-S1-001 至 PR-S1-003，以及修订对原 page 输入、释放和裁剪的影响。未参与实现修订；未修改代码或测试，未连接生产。人工窗口仍按用户批准的 30 秒，计时协调器和正式前端属于后续切片。

## 结论

**PASS（S1 adapter 正确性与受控浏览器可行性范围）。** 第一轮 2 项 P1、1 项 P2 均已 VERIFIED/CLOSED；本轮未发现新增阻断后续切片的产品交互缺陷。

可以继续 S2/S3，不等同整个远程人工验证功能已完成。真实平台放行、控制台正式流程、权限/操作权、30 秒计时、WSS 和并发性能仍须后续独立验收。测试中的 verdict 均为受控路由结果，不能作为生产自动或人工验证成功证据。

## 实际验证结果

本人重新执行：

`node --import tsx --test scripts/verification-remote-browser.test.ts`

工作目录：`F:/ChenHai/Project/XianYuAgent/apps/api`。

结果：**6/6 PASS，0 fail、0 skip、0 todo**，总时长约 7.66 秒。本次跨域 iframe 拖动 evidence 为 elapsedMs=273、JPEG=1542 bytes。这是一次完整受控拖动的耗时，不是单次 ACK p95，不与 250ms ACK 指标混为一谈。

另经 `node --import tsx --input-type=module` stdin 运行独立真实 Chrome 探针，使用独立临时 profile 并在 finally 关闭和清理：

- 首次 admit 阻塞期间调用 release，随后解除阻塞：旧 down 被拒绝，release 完成后无旧 down。
- 同一 adapter、同一仍新鲜 frame 上发送后续全新手势：真实 down/up 成功，证明释放没有永久废掉人工输入。
- 首次 admit 中导航到同 origin、完全不含挑战的 `/im`：旧 pointer 以 STALE 拒绝，新的页面零 down。

实际输出：

```text
release cancelled old down; next fresh gesture succeeded
first-admit navigation to non-challenge page rejected with zero down
```

本轮没有独立重跑 API typecheck；主 Agent 提供的 typecheck PASS 仍归其验证记录。

## 第一轮问题闭环

| 编号 | 级别 | 状态 | 修订与复核证据 |
| --- | --- | --- | --- |
| PR-S1-001 | P1 | VERIFIED/CLOSED | pointer 捕获 inputGeneration，valid() 同时检查 closed、generation、frames 中同一引用、streamEpoch、geometryRevision 和帧时效；check() 在异步 admit 后重检并重新 locate；每次真实 mouse dispatch 前再检查。已有测试在第二次 admit 中导航并断言新页零 down；独立探针补充第一次 admit 导航到无挑战页面，原复现不再成立。 |
| PR-S1-002 | P1 | VERIFIED/CLOSED | release() 立即递增 inputGeneration，使先前已入队/在途 operation 同步失效，清理通过同一 tail 排空；close()/导航也失效旧输入。新版真实 Chrome 测试覆盖阻塞授权期间 release 与 close，均没有旧 down；独立探针再确认 release 后新手势仍可用。原 up,down 反例已消除。 |
| PR-S1-003 | P2 | VERIFIED/CLOSED | geometry 改为挑战 box 与 viewport 的真实矩形交集，宽高使用 min(right/bottom)-max(left/top)。测试断言左上负坐标、右侧、下侧及完全越界；新的受控操作页以 330×75 显示真实 JPEG、真实触屏事件映射回原 page，并检查 isTrusted、坐标和 down/up。JPEG 右边缘绿色像素断言排除邻接 magenta 私有区域。 |

## 测试真实性与契约复核

- 原 page 仍来自既有 browser factory/context，没有为人工操作建立第二套目标浏览器。触控测试的第二个 Chrome 是测试操作者页面，用于生成真实触屏事件，并非替换服务器挑战 page。
- 跨域 iframe 的真实鼠标事件触发受控页面 fetch，仍可证明坐标跨 frame 映射可行；测试已把名称改成 controlled protocol verdict，避免“真实平台”误读。
- 顶层及 iframe 在 capture 过程中导航，旧截图均丢弃；发送前导航由 canSend 拒绝，SPA 更换容器仍拒绝出帧。这些新增断言补足第一轮仅有测试名称而无实际导航的缺口。
- 私有 generation/帧边界不再只依赖外部 admit。admit 仍留给未来 owner 的权限/lease/操作权准入，职责分配合理。
- release 返回才是可确认输入屏障。后续协调器必须在已撤销旧操作权后 await 此屏障；遇到底层释放失败或等待超过设计时限，按设计关闭原 context 并确认清理，不能只调用 adapter.close 后假定浏览器已退出。

## 留给后续切片的必要验证

以下均不在本次 adapter PASS 内，不得沿用本结论宣称通过：

1. 正式 Web 的 letterbox、响应式布局、缩放与完整触屏拖动；当前测试证明的是缩放图片上的真实触控点击转原 page 鼠标，而非完整移动端最终 UI。
2. WSS/HTTP 鉴权、manage 到期/撤销、控制 epoch、幂等 command、多个操作者、5 秒/30 秒及 settling 状态转换。
3. 慢网、背压、2 会话同时运行下的 ACK p95/帧延迟 p95、普通 API 增幅和持续内存/队列上限。
4. 平台 verdict、会话交接、身份校验、凭证提交、来源风险核销、IM 注册及新鲜心跳的真实跨层证据。

这些要求已属于原设计后续验收，不能以受控 Chrome 的 6 个通过测试替代。

## 下一步

第一轮 PR-S1-001、PR-S1-002、PR-S1-003 可以由本审核者确认关闭，保留 R1 原文与本复审记录。允许进入后续实施切片；不授权生产部署，也不报告整项功能完成。
