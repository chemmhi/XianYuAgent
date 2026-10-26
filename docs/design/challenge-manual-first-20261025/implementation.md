# 人工优先挑战实施记录

2026-10-26：用户批准按方案实施，将人工窗口改为30秒，要求代码完成后独立Agent审核。授权本地编码与测试，不包含部署。

## 修改前检查

- 架构：TypeScript/Node24，API为唯一浏览器与IM owner，worker经Redis/RPC唤醒；React/Vite前端，PG持久化，Patchright独立port。
- 生产文件：xianyu-verification-browser、browser-port、patchright适配、im-service、qr-login、read-recovery、store-postgres、app装配；Web App/账号/QR。
- 测试：apps/api/scripts的post-challenge、im-credentials、verification-recovery、guard-e2e；Web Vitest及Chrome E2E。
- 命令：npm run typecheck/build；npm --workspace apps/api run test:xianyu-post-challenge / test:xianyu-im-credentials / test:xianyu-verification-guard:e2e；npm --workspace apps/web test。
- 模块边界：remote-browser只负责原page截帧/输入与导航fence；coordinator负责状态/租约/时限；repository负责PG事务/预算；transport负责鉴权与WS；Web独立model/controller/Panel。
- 验收：5秒优先、30秒独占人工、结果settling、无双控、code0后真实业务证据、凭证与风险CAS、所有入口、撤权/删除/QR生命周期、图像不泄露、持久化重启和预算。
- 初始工作树：只有上一轮未跟踪设计文档，无代码改动。

## S1 技术门禁

输入：已批准v0.3；目标：原Patchright页面截帧、跨域iframe、鼠标/触控映射与导航停流。
输出：远程适配器与真实Chrome测试、性能证据、独立审核；禁止生产连接/凭证。
状态：实施中。S1通过审核后再接入协调器/业务链。

S1实际验证：API typecheck通过，6项真实Chrome受控协议集成通过；跨域iframe原page拖动、导航/SPA在途图像fence、缩放touch到原page、裁剪JPEG像素与上下左右/完全越界、授权await期间导航、release/close与排队down的回归。初版新增导航回归实际失败（Missing expected rejection），修订后通过。单次拖动微基准约241–295ms，不是传输ACK p95或双会话压测。

S1职责边界：adapter立即使旧输入失效并提供串行释放/关闭屏障；若admit永不返回，release/close本身没有3秒上限。**S2 coordinator必须独立race 3秒deadline，超时直接关闭原BrowserContext，阻止新执行器；不得只await remote.close。** S2故障验收必须注入永不返回的admit，断言3秒后context关闭、旧epoch永不再派发、未确认关闭时不运行自动。此项未在S1冒充已验证。

## S2 状态与凭证门禁（进行中）

- coordinator/domain/repository/migration070：5秒优先、30秒人工、3秒重连/释放上限、10秒settling、owner单调时钟fence、PG状态和事件原子提交、持久化自动预算。
- S2 R1：产品3项、架构6P1+2P2；报告保留原失败证据。actor内前提、共享releaseTask、迟到save闭锁及自行终结、retry授权已修；事件序号明确为每会话version，bigserial仅内部审计主键，列表采用订阅+snapshot，不用bigserial当无缝游标。
- 产品R2新增2P1：二轮settling不能复用旧静默时间；manual_only先提交时自动actor与dispatch均须拒绝。均补真实受控顺序回归，等待R3。
- 当前实际命令：node --import tsx --test apps/api/scripts/verification-coordinator.test.ts =>15/15；MANUAL_VERIFICATION_TEST_DATABASE_URL 指向本机xianyu_manual_verification_test，verification-postgres.test.ts=>2/2。
- 凭证与IM修订及相关测试由独立实施Agent处理，之后由原两位独立审核者复审；实施者不审核自己的修改。
- S2未PASS，尚未进入S3/S4装配。迁移只在隔离测试库执行，生产没有修改。

## S2 门禁通过

- 产品协调器R4 PASS：PR-S2-001～006全部关闭；产品凭证R2 PASS：PR-CRED-PROD-001关闭；架构完整R2 PASS：AR-S2-R1-001～008及R2补充发现全部关闭。
- 当前coordinator18项、原PG2项、credential12项、credential PG6项通过。架构另跑真实Chrome无限admit默认3秒屏障，3135ms关闭原context/page且自动0次。
- API typecheck PASS；完整npm --workspace apps/api test exit0，352项测试（264+24+17+47，无skip）与后续全部既有smoke通过。全量日志在本机TEMP/xianyu-manual-challenge-api-tests.log，不作为产品产物提交。
- 完整回归中更新旧fixture：partial Store补新增风险查询；read mock位于真正request-local client且无心跳时保留Token风险；onboarding仅证明cookie登录成功/credential active，账号保持disconnected，禁止fixture去连真实平台。架构独立确认不是削弱断言。
- 前端基线：107文件、510项Vitest全部通过。
- S2完整PASS，可实施S3原页面→实时控制→界面接线。生产无变更。

## S3 装配与本地实测（尚未整体通过）

范围：本地API/Web、三个分离测试库、原生闲鱼对照和真实本地扫码；不包含生产部署。API唯一owner与原page/context不变。状态/授权/预算在coordinator与repository，原生iframe与截帧/输入在browser适配器，HTTP与WS独立，Web的Provider/Panel/stream/model分工。

界面采用项目共享Button/modal规则，按钮与关闭控件32px；弹窗固定640×540px，低屏按viewport限高并内部滚动。真正420×320原生iframe画面最大1:1显示。准备、画面、清图/重连及结果保留相同槽位，未重绘滑块。

真实诊断明确两个独立问题：原handle在mousedown写SPM埋点，以及原文字span的3秒无限扫光动画使整页computed styles跨时间变化。最小兼容仅允许既有native节点的单次埋点，在所有其他绘制/几何/伪元素及动画定义不变时归一该原span的background-position。结构、未知样式/属性、新动画、遮挡仍使旧帧失效。NC错误态显示安全原生刷新入口，用户主动mousedown刷新后安全重新绑定新控制节点，修订号不归零、原controller/30秒窗口不重置。

Web收到clear立即撤销旧图控制但不因暂时无图误断stream；旧HTTP ACK/decoder不能复活旧图，新图ACK不会因旧请求而遗漏。同连接新图不resume；真实断线才恢复原controller。明确claim遇租约VERSION_CHANGED只在原有效连接/画面/权限/窗口内刷新并重试一次，第二次冲突或状态变化停止。

本代平台结果只公开status/code/sequence/challengeGeneration/observedAt。请求起始序号及watermark拒绝迟到JSON倒序/旧代结果；rawsuccess与严格passed分别记录。300不核销风险、不保存成功凭证，原30秒内允许用户主动原生刷新；最终失败区分PLATFORM_REJECTED和根本没有人工答案。

2026-10-26实际最终Web门禁：`npm --workspace apps/web run test:e2e:verification` exit0，共11条真实React→HTTP/WS→独立PG→原Chrome→凭证CAS/IM链路及边界全部通过，平台响应受控。新增300→保留风险/旧凭证→用户点击原生刷新→第二次code0→CAS/匹配心跳，断言同session/generation/原deadline、0暗中刷新、0自动动作；最终等待已显示的替换安全帧再继续拖动。phase与迟到错误修订后再次完整执行此11条链路，exit0；`npm --workspace apps/web run test`最终为111文件/548项PASS；根`npm run build`（API+Web）及diff检查PASS。受控结果见`docs/evidence/manual-verification/result.json`与`boundaries.json`，不得冒称真实平台放行。

真实平台边界：用户原闲鱼网页手动通过，有code0、Token与18次匹配心跳；本地另轮经用户当次授权，输入转发达到真实/slide，但返回code300/rawsuccess=true，严格未通过。实测0自动动作，账号未恢复；没有把后续结构失效当作初始输入缺陷，也没有暗中再作答。真实本地code0→Token→CAS→心跳尚缺，S3保留FAIL，S4未开始。

最终完整API为436/436及全部smokes exit0；隔离PostgreSQL专项11/11。后台架构R7独立串行48项、输入诊断2项及类型检查PASS，限定后台和受控链路，无新增P0–P2。之前并发失败和各次独审限定范围均保留，未改2秒帧围栏、输入频率或删除测试避开失败。当前回滚方式是撤回S3工作树改动至S2提交d5e9f09；生产无发布与数据回滚事项。

最后一轮UI审查发现结果处理中不应继续申请画面：stream仅在preparing/priority_wait/human_active/auto_active工作；settling/handoff/rechecking清理连接并保留固定画面槽。产品独立探针在实际修前文件复现旧续租HTTP拒绝于新流ACK后返回时会撤销新ready并显示连接错误。修订以effect stopped与WS身份围栏隔离旧错误，decoder同时检查解码代次，cleanup立即清空connectionId与controller-ready。新增3条阶段切换和1条迟到续租/旧WS错误的永久React/Chrome用例；本轮产品修后探针及最终全Web/跨层回归以STATUS及正式产品报告记录，不把待执行项记作PASS。
# 2026-10-26 依据原生流量恢复滑块修复

本轮用户授权先更新已有文档，再继续修复。目标是前端原生人工操作30秒、无人时后端自动，保留同账号代次、原context/device、CAS和业务/IM验收；不继续扩展截图鼠标转发，也不部署生产。

修改前检查：现有API使用VerificationCoordinator仲裁，VerificationRuntime始终装配VerificationRemoteBrowser；Web VerificationPanel仍为图片/Pointer流。后端createBrowserMtopTransport负责原请求重新签名与挑战后重试，XianyuVerificationBrowser负责原上下文，XianyuImService负责身份和原子凭证提交。现有Node/tsx单元、Patchright真实Chrome集成、PostgreSQL和React E2E体系均可复用。工作树含前轮未提交S3改动，逐文件增量修复，不重置或混入无关变更。

已确定的第一切片：原生成功请求保留x5sectag，而prepare及成功保存路径主动按Cookie名删除，且IM输入将精确snapshot降为泛域header；修复为以浏览器/请求隔离会话最终snapshot为准。另收紧loginuser缺失身份时不得借用Token中的ID通过。先增加修前失败的上下文、scope和身份回归，再修改MTOP/browser/IM/read恢复模块；保留原请求重签、handoff屏障、generation/CAS和心跳清风险。

原生呈现切片的依据：已采集公共punishpage SDK存在addCookieToHeader分支，可通过严格source/origin绑定的postMessage带回有限x5sec候选（value/expire毫秒/host），不是sig换票协议。完整签名URL只发给当前被授权控制者；结果候选只能暂存到原BrowserContext并唤醒原业务复验，不写凭证、不清风险、不伪造后端slide accepted。原生呈现/接管须使用独立租约，不能伪造截图frameId。实际平台是否发出该字段、是否能恢复原后端会话仍必须真实验收。

门禁：相关Node回归→API/Web类型及构建→真实Chrome上下文/请求重试→真实UI/API/持久化与连接链路→独立产品/架构两轮复审。真实平台滑块由用户手动；若需要Agent代操作必须当次授权。只有实际Token、身份、凭证CAS及新鲜匹配IM成功才能标记整体修复；不能以静态SDK、受控fixture或HTTP200代替。证据沿用本目录STATUS与原生观察文档。回退仅撤本轮增量，不删除前轮工作树；原生新路径在真实验收前不默认推广生产。

本轮实现：`verification-native-candidate` 负责单 Cookie 候选与 URL 字节保留，`verification-native-http` 负责不落库的 claim/result，coordinator 负责原生租约/结果屏障，`NativeVerificationPanel` 负责 iframe/source/origin/本地截止。保留精确 snapshot 与浏览器最终 Cookie，不按名称删除 x5sectag/x5secdata；loginuser 缺失身份拒绝。原生 flag 默认 false，旧图片路径兼容保留。

实际 `node --import tsx apps/web/scripts/e2e-native-verification.mjs` exit0：真实 UI/API/隔离 PG/原后端 Chrome/CAS/IM；前端 DOM 手柄真实鼠标按住移动，续租不重挂；后端人工期间无挑战 iframe、无 pointer；只有候选 x5sec 与保留 x5sectag 同时进入原请求才由受控接口放行。1440×900、768×700、390×844 均 modal540/body scroll0/完整比例。候选只唤醒业务复验，不伪造 platformResult。完整 Web 113文件561项串行 PASS，根 build PASS；独立产品8项 Chrome PASS，架构两项修前失败反例修后通过，R2 两位限定 PASS 和三图视觉 PASS。新测试已纳入 manual/native E2E 入口；Chrome 密集的 manual 命令改串行，避免资源争抢，未放宽时限或断言。

该受控步骤当时尚待真实验收，`native-result.json`中的`productionPlatformVerified=false`保持原意；随后真实成功见下一节，不能改写旧受控记录冒充平台结果。已接管人工结果未知时保守停止，未接管保留原自动路径，新context接续仍未实现。

## 弹窗结果态修订检查卡（2026-10-26）

输入：用户完成态截图、03-frontend-design.md、现有 modal/card/Button 和原生浏览器回归。现状为 NativeVerificationPanel / VerificationPanel 分别展示结果，540px 外框中终态内容自然收缩却没有底部布局，成功仍展示重试。范围仅 Web 呈现、终态按钮和对应测试，不改原生 iframe 协议、租约、控制权或后端。验收：外框高度稳定；结果图标/标题/说明居中；底部说明与操作有分隔；成功只提供完成，不发 retry；失败可重试且保留错误反馈；账号标题仅名称；正常桌面/手机无内滚动，低屏与长结果可达。复用共享 32px Button、主题色、14/8px 间距。测试先补实际 React/Chrome 修前失败，之后类型/浏览器回归/跨层原生专项；独立产品视觉与数据流评审。原始截图与诊断只留本地，提交限定本轮代码、测试与现有文档；回退本轮原子提交即可。

| 本轮界面尝试 | 实际结果 | 处理与结论 |
| --- | --- | --- |
| 修前新增桌面/手机终态回归 | 2 FAIL | 首次缺少结果/页脚区域；再先检查用户行为，均实际检出成功态仍有1个重试按钮（期望0） |
| 首轮界面实现回归 | 33 PASS / 3 FAIL | 三个旧布局断言要求终态图槽小于80px，属于用户已否定的挤顶布局；改为验证真实结果居中，保留固定外框、无横向/正常屏纵向溢出、低屏可达和12项长结果滚动断言 |
| 次轮组件回归 | 36/36 PASS | 实际React/Chrome测成功关闭、失败新轮次、5终态中心/底部布局、原生续租同iframe、截止与候选围栏 |
| 独审建议补测 | 原生13/13 PASS | 增加retry拒绝后的alert/按钮恢复、QR成功/取消不叠弹窗且不乱关宿主；QR成功/取消说明分别对应继续登录/重新扫码 |
| 内置浏览器视觉页首次启动 | 解析失败 | 临时脚本直接截取测试模板未还原转义；仅修本机被忽略的演示脚本，原生产/测试源码不受影响；修后同生产组件可见，完成态正文/底部按钮与几何已实查 |
| 视觉页外层滚动 | 仅演示背景造成 | 演示背景main与测试root叠加高度，改演示背景定位；生产弹窗正常屏body scroll差0，无额外滚动 |
| 最终Web验证（含保留非终态逐项结果的回归） | 113文件567/567 PASS，build/typecheck PASS | 串行运行，保留所有既有用例 |
| 原生跨层专项 | PASS | 真实UI/API/隔离PG/原后端Chrome/Token身份CAS/IM，平台受控；没有代滑真实闲鱼验证码。三视口540高、完整原生画面，点击完成只收起且不创建新轮次 |
| 独立R1数据流 / R2视觉 | 两轮限定PASS | R1核对终态、retry错误、QR宿主及共享组件；R2实际查看7张桌面/手机/原生截图。无新增P0–P2；不扩大到整体验证自动接续或部署 |

实现收敛为共享VerificationOutcome；Native/Remote在终态使用同一结果组件，onDismiss仅由独立Dialog宿主传入，重试继续使用既有manual_only接口。保留540px外框、主题token、共享Button和原生iframe的420×320比例。因仅呈现/关闭语义窄修，独立两轮数据流与视觉足够，未追加全量API检查；原生跨层和完整Web作为替代证据。原始PNG、私有采集、调试脚本及历史未跟踪报告不提交，main不修改。

## 本轮真实验收与全部尝试台账（2026-10-26）

用户随后亲自完成本地原生滑块：17:55:47.149（Asia/Shanghai）接管返回剩余29996ms；17:55:53.220 POST native/result，SDK字段为value/expire/host；17:55:54.585原业务复验；17:55:56.446会话succeeded。原后端持久化x5sec与该候选原值在本机比较一致（host h5api.m.goofish.com、path /、Secure、SameSite=None），不输出原值。账号已连接/在线，凭证active、真实Token存在、验证风险0，后续IM心跳持续更新。自动手势0，未伪造platformResult。本轮证明了前端原生→后端原会话恢复，不覆盖无人自动或人工超时后的新context接续。

成功与失败均保留，以下台账取代零散调试输出作为正式提交记录：

| 尝试 | 实际结果 | 修订/复验与结论 |
| --- | --- | --- |
| 原会话Cookie、scope、缺失身份回归 | 修前3 FAIL | 修后PASS；独立补测显式失效snapshot不得复活旧jar；相关55项与原有Chrome14项PASS |
| 原生基础协议/消息解析 | Node10与Web3 PASS | 仅证明受控候选/状态机，不称真实平台放行 |
| R1独立claim与二代窗口反例 | 0/2 PASS | 修取消后的URL最终围栏、保留原30秒截止；同文件2/2 PASS |
| 原生跨层fixture首次运行 | CSRF断言403/422不符 | 页面登录已旋转CSRF；测试改读本次实际浏览器会话令牌，保留401/403/422断言 |
| 原生跨层iframe初载检查 | about:blank时过早断言 | 等待真实目标URL及原生控件后检查，不放宽结果断言 |
| 原生跨层手机鼠标驱动 | 手柄未移动；临时诊断引用隔离world的down失败 | Patchright子frame boundingBox未包含CSS transform；驱动用原生DOM rect和真实iframe比例算物理鼠标坐标，保留真实手柄移动和同Document断言；最终跨层PASS |
| 独立React浏览器回归首轮 | 2 PASS / 6 FAIL | 测试错误读取main-world全局；改DOM控制通道，未改生产以迎合测试 |
| 独立React浏览器回归次轮 | 7 PASS / 1 FAIL | 两次1秒续租却只等默认1秒；等待改4秒，保留两次续租断言；最终8/8 PASS |
| 完整API首轮 | 263/264 | 旧fixture依赖平面header和按名删Cookie；表达真实request-local jar并正向检出误删，原scope/属性/次数断言保留，独审14/14 PASS |
| 完整API第二轮 | manual101/103，其余组PASS | 一次Chrome启动Target crashed；一项旧runtime stub缺native配置。显式补false配置，同文件Chrome11/11 PASS，未添加自动重跑或放宽围栏 |
| 完整API第三轮 | 456/456及所有既有smoke PASS | 完整命令exit0；PG事务/CAS另8/8 PASS |
| 完整Web与构建 | 113文件561项PASS；API/Web build PASS | Web文件串行运行，避免多个Chrome资源争抢 |
| 扩展Web跨层全入口 | 旧主链/鼠标场景通过，300刷新分支FAIL | 截图旧分支出现SPM refresh guard/stale epoch，保留为OPEN；全入口在此停止，新原生第三步未被该命令执行。原生专项已独立实际PASS，不能写全入口PASS |
| 本地原生准备/人工等待 | 首次成功之前：1轮PRESENTATION_NOT_READY、4轮WAITING_FOR_HUMAN、1轮接管后30秒结果未知 | 均保持风险、自动0；不归为平台滑块提交失败，也不暗中代答；用户自行新发起一轮后成功 |
| 原生真实人工验收 | 前端候选→后端原会话→Token/身份/CAS/IM→succeeded | 用户手动，账号在线且风险0；/slide正文未采到，不写code0 |
| 实采观察器 | 首轮工具超时、重置后一次文档未读接入失败 | 各私有目录保留失败manifest；重新接入armed后采集。最终495请求/492正文，iframe首请求、附着失败及缓冲截断保留，非全量无损 |
| 成功后的后台刷新 | 18:19:57、18:20:31再次被平台要求验证，两轮PRESENTATION_NOT_READY | 截至18:21快照共9轮（含1成功），没有删除后来失败；本地自动禁用，页面未就绪时不作答。此前成功证明该轮恢复，不代表未来永不再挑战 |

真实原始网络、Cookie、HAR、截图和调试输出仅在本机私有目录，不提交。项目只提交上述正式台账、修复源码及必要测试。当前分支codex/manual-challenge-priority，未直接操作main或发布；暂存清单须单独核对，禁止git add全工作树混入前轮无关/未验收工作。

提交收敛：HEAD只有S2，本轮原生功能必须同时纳入依赖的S3 runtime/HTTP/DTO/状态流、前端Provider/Bridge及账号/QR入口。旧截图的location/currentLocation快缓存和performance采样日志已从待提交实现移除；保留实际使用的安全ROI/原节点检查模块，不能按diagnostics文件名误删安全依赖。最终验证须针对仅含待提交文件的导出目录，不能直接沿用此前脏工作树456/561结果。旧截图刷新FAIL与人工未知后自动接续缺口保留OPEN，分支快照不是main发布或整体S3 PASS。

提交快照实际复验：97个白名单文件从Git索引导出到独立临时目录，依赖链接只供本机执行。该目录完整API `npm --workspace apps/api test` 为456/456及所有既有smoke PASS；完整Web串行113文件561项PASS；根build PASS；原生跨层专项PASS。最后进一步去除所有realtime逐输入/stream诊断打印，保留拒绝ACK reason与close1008；同步导出后APIbuild、HTTP/WS/Chrome及native窄回归21/21 PASS。最终重跑全Web跨层时旧截图300刷新仍FAIL，native专项另行执行，不把前一失败命令称PASS。该分支只交付已验证的原生人工切片供审查，整体S3和发布门禁仍不提升。

提交材料核对：索引无.env、.codex辅助文件、私有采集、HAR/NDJSON、PNG、日志或evidence JSON；追加.gitignore阻止误收。两次独立索引审核核对相对导入及脚本引用闭合、源码不含本轮临时调试采样，正式成功/失败台账保留。旧探针/调试文档及截图留工作区，不因已有本地结果整目录收进提交。
