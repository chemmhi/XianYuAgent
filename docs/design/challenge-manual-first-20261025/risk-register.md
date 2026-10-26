# 方案风险登记

设计风险与实施证据分开记录；S1/S2当前证据见下方实施追加。

## 2026-10-26 当前增量风险

| 编号 | 风险 | 实施证据与边界 | 状态 |
| --- | --- | --- | --- |
| N09-01 | 原生自动claim重复请求、迟到授权或重载延长人工时间 | 同步防重、presentation版本、原intent重放、最终可见性/代次复查；真实React/Chrome与受控跨层，独立复审通过 | MITIGATED，本切片 |
| N09-02 | 将鼠标越过轨道误当失败根因 | 真实成功32px、失败15px；两段完整pointerdown/up和slide/token正文保存本机；项目两视口越iframe边沿不取消的回归通过 | 事实已澄清；8778根因与自动成功率仍UNKNOWN |
| N09-03 | 验证码重建后漏采并混拼轨迹 | 新context及真实手柄自检、按docId/gesture分段、被动监听与逐事件字符串落盘；新两段完整，旧失败/漏采保留 | 本轮采集通过；工具不支持预注入，未来新context首事件窗口仍需标记 |
| N09-04 | 已接管但结果未知时向同一挑战自动作答 | 仍保守结束本轮，未实现新context安全接续；UI与真实单轮成功不关闭此缺口 | OPEN，整体S3未通过 |

下列是早期截图方案与各阶段的历史登记，不能据其状态覆盖当前原生路径证据。

| 编号 | 风险 | 设计处理/验收门槛 | 状态 |
| --- | --- | --- | --- |
| D01 | 图片帧方案延迟使人工滑块难以操作 | S1实测指针与画面延迟、触控和跨域iframe；未达性能门槛不开放人工控制 | OPEN，实施前验证 |
| D02 | 平台code=300或会话交接持续超时 | 人工/自动不绕过业务复验；增加脱敏交接诊断；真实平台验收独立记录 | OPEN，平台不确定性 |
| D03 | 5秒截止、多个标签页和自动求解发生双控 | server CAS/epoch/唯一展示与控制租约；动作释放屏障；真实并发测试 | DESIGN_MITIGATED，待测试 |
| D04 | 图像或输入泄露到其他账号/管理员 | active manage授权、临时登录归属、每次传输重检、挑战区域裁剪、导航停流、无录制 | DESIGN_MITIGATED，待测试 |
| D05 | owner崩溃或profile遗留导致双浏览器和旧凭证写回 | 单owner、generation失效、确认旧浏览器退出后再恢复、凭证与风险CAS | DESIGN_MITIGATED，待故障注入 |
| D06 | 用户未接管导致不断挑战放大风控 | 持久化subject级自动预算与退避/熔断，新URL/revision/重启不重置 | DESIGN_MITIGATED，待测试 |
| D07 | QR临时会话与账号恢复会话越权或profile冲突 | subject二选一、QR generation、账号新登录先取消旧恢复、正式保存后才建号 | DESIGN_MITIGATED，待测试 |
| D08 | 图片截图占用影响正常业务 | 两并发、限帧/限带宽、最新帧背压、压测与基线对比门槛 | OPEN，实施前实测 |
| D09 | 失败后自动重放发货/改价等写操作 | 保留现有只读重放白名单和写操作结果核对边界；请求次数验收 | DESIGN_MITIGATED，待测试 |
| D10 | 人工刚提交答案即因30秒超时被自动重试 | settling有界等待答案；结果未知则停止，不盲目自动；T16 | 设计已复审，待实现测试 |
| D11 | 既有IM/QR无条件凭证写绕过新协调器 | 账号generation权威、所有凭证入口fence、受控QR rebind；T22/T23 | 设计已复审，待实现测试 |
| D12 | 部分来源恢复后显示整体正常 | executionOutcome与accountHealth/sourceResults分离，写来源保留直到明确业务证据；T17 | 设计已复审，待实现测试 |
| D13 | QR刷新或crash绕过自动预算 | flow/admin/account稳定bucket与派发前事务预留；T24 | 设计已复审，待实现测试 |


## 实施追加（2026-10-26）

- D01：S1真实Chrome跨域iframe、触控缩放、裁剪/导航fence6项已验证；完整传输延迟/双会话性能仍OPEN。
- D03/D05：S2 coordinator18项产品独立R4 PASS；含临界点互斥、共享释放、二轮settling、manual_only竞争、迟到save、DB失败终结、关闭未确认的subject屏障、异步启动容量预留。架构真实Chrome默认3秒无限admit探针约3.2秒关context、零自动。
- D06/D13：隔离PG预算与CAS2项PASS，QR绑定后的预算迁移仍待S4。
- D10：29.9秒提交、30秒后答案到达保持settling并优先接纳回归PASS；正式网络链待后续。
- D11：generation+snapshot、真实WS注册后匹配心跳、新revision和旧socket/新login回归已聚合90项PASS；架构新发现PG惰性expiry旧写入口，FIXING，未关闭。
- S2产品PR-S2-001～006：独立R4 CLOSED；架构AR-S2-R1-001～003/007/008：范围复验通过，AR004～006等待完整凭证复审最终结论。
- 所有通过均为本机/隔离依赖；生产平台code300、handoff失败和生产实际恢复没有在本轮重新验证。
