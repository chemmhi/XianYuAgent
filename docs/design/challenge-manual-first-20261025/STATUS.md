# 人工优先挑战实施状态

## 2026-10-26 本轮修订的当前结论

- **本轮原生人工链路真实通过；整体 S3 仍 FAIL**，保留自动接续与旧截图回归的缺口，未部署。下文旧截图链路与早期实验为历史证据，不代表本轮原生路径的实现状态。
- 本轮原生采集的请求顺序、实际 Cookie 比较、跨标签覆盖和采集缺口已更新到 `native-observer-preflight-20261026.md`、`native-browser-direction-20261026.md` 与 `implementation.md`；凭证原值只在本机私有档案，不进项目文档。
- 本轮实现：默认关闭的 `XIANYU_VERIFICATION_NATIVE_ENABLED` 分支，由前端浏览器直接加载平台原生 iframe。人工期间后端不渲染该挑战，不启用截图/鼠标转发；420×320 内容完整等比缩放，弹窗固定 540px，仅显示账号名。
- SDK 的 `addCookieToHeader` 消息只作为有限 x5sec 候选。前端检查当前 iframe/source/origin/代次，后端绑定 auth/client/lease/generation/epoch，候选只应用于原 context；重新签原 MTOP、检查身份、原子提交凭证并得到匹配 IM 心跳，才能确认恢复。占位消息和前端完成不伪造平台 accepted。
- 已修复 Cookie 按名称误删、精确 snapshot 泛化、loginuser 缺失身份却借用 Token ID。新增回归修前 3 FAIL、修后通过；独立补测覆盖 request-local snapshot 显式失效时不得复活旧 metadata。
- 独审 R1 发现并修复：DTO 等待期间取消后仍返回旧 URL、二代挑战延长原 30 秒、断续租未按本地截止卸载、迟到 claim 遗留控制、关闭文案错误承诺自动接续。架构/产品 R2 限定 PASS，三图视觉独审 PASS；见 `code-native-bridge-architecture-r2.md`、`code-native-bridge-product-r2.md`。
- 已验证：完整 Web 串行 **113 文件 / 561 项 PASS**，API/Web 构建 PASS；原生跨层真实 React → HTTP → 隔离 PG → 原后端 Chrome → Token/身份/CAS → IM 心跳 PASS。真实鼠标移动、续租不更换 iframe/Document、三视口固定高且 scroll=0、0 图流/0 转发 pointer、session DB 不保存候选/URL。证据 `docs/evidence/manual-verification/native-result.json` 与 `native-human-*.png`。平台响应受控，不是闲鱼真实通过证明。
- 完整 API 最终 **456/456 + 全部既有 smoke PASS**，PG 事务/CAS 专项 **8/8 PASS**。首轮旧 credential fixture 263/264；第二轮 manual 101/103（Chrome 启动崩溃及旧 runtime stub 缺新配置）；修订夹具、独审并原样复跑后通过。完整 Web E2E 中旧截图300刷新分支仍失败，新原生专项跨层单独 PASS。全部成功/失败及处理见 implementation.md 本轮尝试台账，不删失败来宣称全绿。
- 限制：无人接管仍走后端自动；**已前端接管但结果未知**时停止本轮并关闭后端 context，不对同一挑战再自动作答。新 context 安全接续尚未实现，不能称“人工 30 秒后自动”已完成。
- **真实验收已完成**：用户在本地隔离环境手动滑动；17:55:47.149 接管（剩余29996ms），17:55:53.220 原生候选进入 result，17:55:54.585 rechecking，17:55:56.446 succeeded。实际候选原值与原后端保存的 x5sec 本机比较相等，账号 connected/在线、凭证 active、有真实 Token、风险0，心跳后续持续刷新，自动0次。未捕获本轮 /slide 正文，故不补造code0证据。脱敏验证摘要 native-real-result-20261026.json 留本地，本机私有原档2026-10-26T09-51-00-004Z-9c439bef，495请求/492正文且覆盖不完整。默认 flag 关闭、本地显式开启，生产无变更。
- 提交边界：仅本轮修复、必要依赖/测试和正式文档。原始采集、凭证、截图、HAR、临时 probe、调试日志与执行态文件不提交；在 codex 分支审查，不直接合入 main。
- 首次成功后18:19:57、18:20:31的后台刷新再次触发平台验证，均因页面未就绪结束，自动0次；截至18:21本机快照共9轮，1成功、8失败（准备/未接管/超时及后来新挑战），不把一次成功写为永久无需验证。完整细分见implementation台账。
- 最终提交快照独立导出后：完整API456/456+smoke、Web561、build、原生专项PASS；清除最后输入/stream诊断打印后APIbuild和窄传输21/21 PASS。旧截图300刷新在该快照仍FAIL，保持OPEN；该已验证原生人工切片的分支提交不等于整体S3或生产发布通过。

## 前轮记录（保留历史）

- 用户批准：2026-10-26，人工窗口 30 秒，其他按方案实施，完成后独立代码审核。
- 设计：v0.3 两位独立设计审核 R2 PASS；用户后续要求改为居中弹窗与30秒人工窗口，proposal v0.5、frontend-acceptance v0.6。
- 最近通过：S1、S2，提交 d5e9f09；详见下文最终门禁。
- 当前：S3 传输与真实界面链路，FAIL。用户真实持续拖动再次出现不移动/清图，重开输入与帧供给缺陷；前次受控通过不能证明此场景有效。
- 当前目标（2026-10-26 本轮更新）：用户已要求依据真实采集重新修复滑块。先更新已有文档，再定位原生人工显示与后端原会话恢复的实际衔接；保留30秒人工、后台自动互斥及业务复验。停止截图转发的继续扩展，不把原生iframe已显示或slide成功当成后端恢复。决策与未知见native-browser-direction-20261026.md。
- 本轮原生Goofish真实流程已取到关键证据：15:18:35.426（Asia/Shanghai）login.token返回FAIL_SYS_USER_VALIDATE/RGV587_ERROR；15:18:40.508 slide返回code=0/success=true；15:18:40.692同接口携新增x5sec重试为SUCCESS；随后session.sync和9次user.query均SUCCESS。对比实际请求原值，_m_h5_tk/_enc、cookie2、sgcookie、x5sectag相同，tfstk变化。原标签与点击新开标签均接入。它证明同一原生用户浏览器的恢复链，仍未证明项目前端能恢复后端原context/device。
- 本轮采集通过已安装browser-network-recorder执行，共423请求/337份正文，19份Cookie快照、80条WS元信息；因读取超时停止后补取1064事件、200份正文，86请求仍缺正文。关键验证响应均补回，缓冲截断、新tab/iframe首请求及中断窗口保留，不能称全量无损。原凭证仅在本机私有会话2026-10-26T07-11-50-053Z-7e7e124e，不入Git。详见native-observer-preflight-20261026.md。旧探针14项、40/40/800及新tab首请求失败属于历史预检，不能替代本轮真实结果。
- 原生iframe最新真实结果：此前空白不是稳定不可嵌入结论。用户在15173项目页上方原生iframe实际看到完整控件并顺滑拖动；IAB子target网络捕获前三次/slide为300，第四次code=0/success=true。成功响应设置前端host-only x5sec（Secure/SameSite=None/非HttpOnly），无阻断。前端unb与目标账号比较匹配；未导出Cookie值、未向backend导入Cookie。code0后原生页仍显示加载中，未证明前端Token恢复。随后原backend原device复查仍verification_required/NATIVE_PROBE_CAPTURED，未进入Token/身份/IM成功链。因此A呈现与严格slide通过成立，完整后端恢复本轮FAIL；不将Cookie阻断或账号错误断定为唯一原因。见native-direct-iframe-manual-20261026.json、native-direct-platform-response-20261026.json、native-direct-cookie-attributes-20261026.json、native-direct-postprocessing-20261026.json和next-experiment-review.md。
- 最新实验：项目页已真实显示完整420×320静态DOM/CSS滑块，滑轨300×34、手柄42×30；不含平台脚本或canvas。仅显示通过，不等于原生SDK在前端执行或平台验证通过。证据为native-feasibility-experiment-20261026.json及dom-display-feasibility-20261026.png；真实输入、Token恢复与IM心跳均未验证。
- 本轮系统输入通道检查中止：官方computer-use在读取独立Chrome的普通本地拖动fixture窗口时，因无法可靠确认当前网址而要求停止本轮。尚未点击、拖动或提交验证码，未改用其他输入工具绕过；18082 fixture和独立Chrome已关闭，临时public probe页已删除。实验输入helper独立静态审核R1提出3项P1，不能据显示结果开放真实输入。详见native-probe-helper-static-r1.md及native-input-blocked-20261026.json。
- 用户随后要求优先参考NightYuYyy/XianYuAgent：已完成feat/remote-slider-solver分支69项增量及实际求解源码核对，核心为Windows系统鼠标执行器+Cookie回传，另有人脸二维码验证；不是普通跨域网页读取Cookie。详见upstream-nightyu-readonly-review.md、reference-priority-checkpoint-20261026.md。新临时实测已暂停并关闭18081/删除临时public页；仅部分显示结果，未完成原生验证或镜像拖动。
- 新UI窄修：标题仅账号名、普通屏无冗余滚动、终态不保留验证码大槽，固定外框不变。作者真实React/Chrome20/20、Webbuild/typecheck通过；根完整Web111文件550/550通过，IAB真实终态640×540/body437=scroll437/标题逐星智能，截图已保存。根视觉审核desktop原图420×320和mobilefailed；架构独立R5静态+三视口视觉限定UI PASS，见code-s3-selection-r5-ui-v07.md。它不覆盖原生跨会话方案或截图cache P1。
- 截图链路未完成修订：旧candidate过期撤新epoch修前FAIL修后PASS；75ms服务延迟+33ms输入在queue17断流1008，未修flowcontrol。缓存安全等价P1补码未最终复审；已停止后续测试/实现，不重启未完成backend工作树到live，也不宣称截图拖动已修好。此前API436/PG11等结果只属于上一冻结版本。
- 已修且独审通过：项目统一弹窗/按钮、重试状态投影、禁自动结束、异步GET最终权限复核、完整安全ROI、输入快路径和manual retry竞态。后台架构R4限定通过，产品R1限定通过，UI/selection R3限定通过。
- 后台最终实测：完整API npm test为436/436及全部smokes exit0，manual入口83/83；独立PostgreSQL专项11/11。后台架构R7独立串行48项+诊断2项、类型检查PASS，无新增P0–P2；限定后台与受控平台链，不签真实平台放行。
- 界面跨层：最终受控平台真实触控React→API→PG→Chrome→Token CAS→匹配IM心跳主链及10项边界全部PASS，完整test:e2e:verification exit0；含native鼠标按住不重连、300→人工原生刷新→再拖动→业务恢复，0暗中刷新、同session/generation/原deadline、0自动手势。它不能替代真实闲鱼验收。
- 原生闲鱼参考页：用户人工通过，实际slide code=0、Token SUCCESS、18次匹配心跳；这不能替代本地输入转发验收。
- 本地真实平台：扫码授权成功；同原page/context嵌入420×320原生pc-ajax。首因SPM埋点+已有3秒文字扫光动画已实证定位并做最小兼容；修订后DOWN与前4个MOVE均获ACK，真实/slide返回300/rawsuccess=true，严格未通过、0自动动作、没有Token/CAS/IM恢复。该轮授权已提交平台，Agent未暗中继续真实作答。错误态/刷新帧及准确失败状态已通过受控跨层回归，实际平台正向复验尚缺。
- 最新UI修订：固定540px外框（低屏限高），四状态图槽稳定；clear续流、同连接不resume、旧ACK围栏及新帧排队均已独审通过；明确claim遇租约版本冲突仅有界刷新重试一次。结果处理settling/handoff/rechecking停止不适用的图流，旧续租、旧WS错误和旧decoder不能撤销新连接；新增3项阶段回归及1项迟到错误回归。产品独立探针实测修前FAIL、修后PASS，架构独立静态复审PASS；产品永久实际React/Chrome最终18/18独立复验PASS。本轮全Web111文件548/548、根API+Web构建、类型与diff检查、最终11条跨层PASS。
- 实际失败保留：SPM首次paint兼容仍误拦动画，后续已确证并修订；多Chrome并发聚合曾manual73/74、PG9/10、独审14/15，涉及帧过期/HTTP版本冲突，未掩盖为PASS；已停止并发，后续按单独窗口顺序复跑，2秒帧围栏不放宽。
- 范围：本地编码、隔离测试库、独立审核；未部署生产。真实本地验证使用单独live测试库，自动滑动已禁用；最终API18080已重启，Web15173实际登录/账号风险/420×320原生画面已再次在IAB检查，外框实测640×540。未执行新真实滑动；下一轮需用户手动或当次授权。
- 待完成：S3复审通过，S4业务/QR生命周期及跨层测试，最终独立审核与文档。
- 详细证据：implementation.md、code-s1-*、code-s2-*。

## S2 最终门禁

S2 已PASS。产品协调器R4、产品凭证R2、架构完整R2均PASS，所有已提出P0-P2已关闭。完整API回归352项+全部既有smokes exit0，APItypecheck通过。当前切片转入S3传输/界面装配；新切片尚未验收，整体功能仍未完成。
