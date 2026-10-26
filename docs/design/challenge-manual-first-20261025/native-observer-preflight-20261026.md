# 原生闲鱼观察探针修订与验收

用户要求修复前次缓冲覆盖，并覆盖内置浏览器中所有闲鱼域标签，包括新开标签。用户另已明确授权凭证原值仅存本地用于比较。本轮未操作真实验证码、未发送业务消息、未写生产或账号数据库。

## 结果

收集器与管理器拆为ignored本地实验模块。所有浏览器调用通过CUA文档接口执行。管理器在显式await的采集窗口内持续发现标签、分页读取、按tab/target/session/requestId/redirect hop关联并追加NDJSON；独立读取跨站iframe子target并去重。正文有界排队，RPC顺序执行；超时停止派发，落盘失败或缺失明确标记。没有工具窗口结束后仍能常驻采集的承诺。

凭证原值保存在 `.codex-private/native-observer/`；该目录被Git忽略，Windows ACL只允许当前用户。公开报告仅保存状态、结果码、数量和Cookie变更名称，不包含凭证值。保留全量相关Cookie快照、选定认证/挑战请求及响应原文；不持久化聊天正文。

| 实际IAB测试 | 服务端真值 | 请求/正文收齐 | 结论 |
| --- | ---: | ---: | --- |
| 已接入主标签小批量 | 40 | 40 / 40 | PASS，逐ordinal无重复或漏失 |
| 已接入跨站iframe | 40 | 40 / 40 | PASS，逐ordinal无重复或漏失 |
| 已接入标签请求高峰 | 800 | 800 / 800 | PASS，0截断、0正文错误、0遗留任务 |
| 新标签打开后立即请求 | 1 | 0 / 0 | FAIL，自动发现并接入成立，首请求未捕获 |

对账详情见 `docs/evidence/manual-verification/native-observer-preflight-20261026.json`。收集器实际14/14 Node通过；独立管理器fake测试与限定评审见 `native-observer-static-r3.md`。早期后台timer/browserRPC失效、并行悬挂及工具超时的失败保留，不以本轮正常用例覆盖历史失败。

## 观察窗口与新标签边界

目前公开API为tab级CDP，不能在任意新标签首导航前统一启用Network。新标签和新跨站iframe接入前的请求可能缺失，必须保留覆盖告警，不能称任意新开标签完全无损。下一轮若需完整case：先确认相关标签已接入，再刷新一次该页作为case起点；此后人工验证，回其他页，直到观察器完成收尾。未接入前已经发生的请求不能补造。

此前预检仅完成Goofish tab2的接入与基线检查。工具调用结束后为准备态而非持续录制态；实际录制必须保持显式await窗口，新开Goofish标签在窗口内自动发现和接入。以下是用户随后完成真实流程后的最新结果，不再停留于“待开始”。

## 2026-10-26 真实跨标签流程与关键证据

本轮使用已提取的browser-network-recorder，匹配goofish.com及子域的全部标签，并采集其第三方HTTP资源。原标签2、用户点击新开的标签26及相关iframe均已接入。raw资源、请求签名、实际Cookie值与API响应仅保存本机私有目录；WS只保留80条方向/长度元信息，无帧原文。用户自行完成滑块，Agent没有求解或重发验证，也没有修改生产。

| 时间（Asia/Shanghai） | 请求/响应 | 可确认的事实 |
| --- | --- | --- |
| 15:18:35.426 | mtop.taobao.idlemessage.pc.login.token/1.0 | ret包含FAIL_SYS_USER_VALIDATE、RGV587_ERROR |
| 15:18:35.488 | 同一路径的_____tmd_____/punish | 加载原生挑战与关联SDK、样式、初始化请求 |
| 15:18:40.508 | _____tmd_____/slide | 响应code=0、success=true，result含code/sig |
| 15:18:40.692 | 原login.token再次调用 | 请求Cookie新增x5sec，响应ret=SUCCESS |
| 15:18:41.408 | pc.session.sync/3.0 | ret=SUCCESS |
| 15:18:41.488起 | pc.user.query/4.0，共9次 | ret均为SUCCESS |

上述关键请求/响应正文均已保存。对比两个login.token实际发送的Cookie原值：x5sec由无到有、tfstk变化；_m_h5_tk、_m_h5_tk_enc、cookie2、sgcookie、x5sectag等值。因此不能假设每次滑块成功都会更换基础登录Cookie，也不能把仅提取x5sec推定为充分的跨会话迁移。

### 完整性与证据位置

423个请求、337份正文、19份Cookie快照；正文SHA-256全部匹配保存字节。实时读取超时后停止，随后从浏览器保留缓冲补取1064事件、200份正文。86请求仍缺正文，含排除类型、失败/目标生命周期变化和无法恢复的缓存；缺口、原观察窗口间隔和中断状态均保留。最终全域Cookie快照读取超时，验证后凭证变化由实际请求headers证明，不伪称完整前后快照。

本机私有根目录：`C:/Users/Chenchen/.codex-private/browser-captures/2026-10-26T07-11-50-053Z-7e7e124e/`，Windows ACL仅当前用户。`RESULT.md`为可读报告，`combined/archive/archive.json`与`archive.har`为合并档案，`verification-findings-private.json`为业务返回值和无原值凭证差异，原始/补采NDJSON及manifest均保留。不得把这些原始文件加入Git或上传。

本轮足以确认同一用户浏览器内挑战通过和消息业务恢复，不能证明项目origin/后端原会话恢复，不能声称所有资源无损或完整交互回放。原生接入修复应以重试原读请求、业务SUCCESS、身份一致、后端凭证CAS及IM心跳为验收，见native-browser-direction-20261026.md。

## 修复后的本地真实验收（17:55，独立case）

用户在127.0.0.1:15173的项目弹窗中亲自完成原生滑块。17:55:47.149接管成功，响应剩余29996ms；17:55:53.220原生候选（仅value/expire/host）进入native/result并返回handoff；PG事件17:55:54.585为rechecking、17:55:56.446为succeeded。候选原值与原后端持久化x5sec本机比较一致，账号connected/在线、凭证active且真实Token存在、风险0，匹配IM心跳后续持续更新。前端候选不伪造后端platformResult，自动0次。它是前轮“项目iframe通过但backend仍需验证”之后的新成功case，失败历史仍保留。

私有会话2026-10-26T09-51-00-004Z-9c439bef最终495请求/492正文、124条WS元信息，已生成本地archive/HAR。coverageComplete=false，保留新iframe首请求、iframe附着失败和事件缓冲截断。此次未捕获前端/slide正文，因此只能确认真实候选交接与原后端业务恢复，不能写已观察到code0。前两次准备采集的工具超时/初始接入失败目录也保留，不用后一次成功覆盖。原始值、HAR及截图不提交，正式结果见STATUS和implementation台账。
