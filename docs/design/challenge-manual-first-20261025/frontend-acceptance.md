# 验证弹窗界面验收基线 v0.9

依据：用户批准 proposal.md v0.3，人工总窗口30秒。没有另附Figma；复用当前账号页面和全站主题作为视觉基线，不替换现有账号表格布局。

## v0.9 中间态与直接呈现（2026-10-26）

原生路径取消“先确认我来操作”的额外步骤。弹窗真实可见且聚焦、取得presentation租约后，每个session/generation自动claim一次，原生滑块就绪后直接操作；隐藏或被覆盖页面不抢控制。准备/自动/等待候选/他页控制/交接复验均使用与结果态一致的居中图标、标题、说明和底部区域，保留共享Button、主题token与14px/8px间距。顶部30秒只在human_active显示，不再显示5秒确认倒计时；后端截止不因加载、续租、重试丢响应而延长。加载失败只提供明确“重新加载验证”，不暗中反复claim。晚到授权需再检查可见性、权限与代次，不得复活已关闭窗口。

原生420×320 iframe完整等比显示，不绘制镜像滑块、拦截指针或代替SDK判定越界。正常桌面1440×900、手机390×844固定540高且主体无滚动；只有低屏或真实长内容允许滚动。已有结果态仍按v0.8：成功只完成关闭，失败可重试。他页控制说明为“请等待其他页面完成验证，结果会自动同步。”，不要求本页滑动。

验证：中间态修前两项FAIL，修后桌面/手机七类状态居中与页脚几何通过；新增自动呈现、隐藏迟到grant、丢响应原版本/截止及两视口越界持续续租保护，原生组件19/19实际React/Chrome PASS，Web build/typecheck PASS。更早完整Web578及受控跨层原生专项PASS见implementation.md；后续最终计数按该台账更新。两轮独立架构与视觉复审限定PASS，修正P2已复看两视口截图。真实原生成功/失败对照均允许越过轨道，不能把越界直接解释为失败；原始轨迹不提交。

以下旧接管/图流说明适用于保留的remote兼容路径或前轮记录，不能用于要求新native路径继续显示二次确认。人工接管结果未知后的新context自动接续仍未完成，本修订不承诺该能力。

## v0.8 结果态布局修订（2026-10-26）

用户否定 v0.7 完成态截图中内容挤顶、下方空白及成功后的重试按钮。当前结果态改为：固定540px外框内，图标、单一标题与说明垂直居中；底部14px分隔与说明/操作横排，窄屏自然换行。使用主题语义色、inline SVG、共享32px Button；成功仅“完成”，部分完成“关闭”并明确回原页面核对，失败/过期/普通取消提供“关闭 / 我来重试”。QR嵌入不接独立弹窗的完成回调，已取消QR不重试。长结果和极矮屏仍允许主体滚动，不隐藏溢出。

实际验证：原生组件13项真实React/Chrome、Provider20项、静态组件6项通过；完整Web113文件567项通过，Web构建通过；原生UI→HTTP→隔离PG→原后端Chrome→Token/身份/CAS→IM专项通过。成功“完成”关闭且不新增轮次另有跨层断言。桌面1440×900和手机390×844的五种终态均固定540高、body scroll差0、结果相对中心误差小于2px、footer底部间距小于2px；原生420×320完整显示。内置浏览器也检查了同一生产组件的受控完成态，未对真实账号重新发起挑战。

独立数据流审核与7张桌面/手机/原生截图视觉审核均限定PASS，无新增P0–P2。以下v0.7数值保留为历史结果，不作为当前结果态布局要求。成功/失败尝试详见implementation.md；原始截图、诊断、HAR不提交。

## 页面与状态映射

- 全站已登录外壳：VerificationProvider 维护授权会话列表与presence；居中弹窗展示单一活动Panel，其他会话按readyAt列队。
- 账号行：需要验证时提供“查看验证/我来重试”，重试固定manual_only；扫码授权仍可用。
- QR登录：verificationPresentation=remote时暂停二维码，原内容区嵌入同一个Panel；不渲染原始平台链接，不叠第二个modal。
- Panel：准备画面、5秒人工优先、30秒人工控制、自动中、释放/结果确认、业务复验、成功、部分完成、失败、过期、取消、断网重连均有明确文案。

## 布局与视觉假设

- 目标viewport：1440×900桌面、390×844触控；单一居中弹窗，桌面固定外框640×540px（高度沿用现有账号登录弹窗），宽度受可用空间约束。高度统一为min(540px,100dvh−56px)，不随准备/首帧/重连/失败改变；header固定，主体内部滚动，长结果不推动外框。
- 当前仓库没有共享Dialog组件；复用styles.css的`modal-backdrop / modal-card / modal-head / modal-actions`与`card`。操作按钮统一使用`shared/ui/Button`，关闭按钮复用`icon-button`，不覆写按钮最小宽高、字号或内边距。当前共享Button默认32px高、14px字，图标按钮32px；不沿用上一版自行添加的44px和108px限制。
- 间距沿用现有14px内容间距、8px操作间距，颜色与卡片形状来自现有主题。验证码画面外不再叠加边框卡片、底色和内边距；保留账号标题、接管状态/倒计时与必要按钮，常驻提示收敛为当前状态所需一行。业务写操作不重放的说明仅在结果阶段显示。
- 摘要使用自然内容高度；主体按剩余空间分配画面，不将54px摘要和320px画面相加成固定最小高度。桌面及390×844正常准备/原生画面/普通失败态应无内部溢出；终态将剩余空间分配给居中的结果展示，底部独立放置说明与操作，不将内容全部挤在顶部。外框仍固定540px，低屏或真实长结果才滚动，重试按钮与末项可达。
- 画面保留JPEG原图，以frame.width/height对应的原页面CSS像素为最大1:1显示（不直接依赖可能含DPR的JPEG自然像素）；宽度取原宽、容器可用宽度、剩余画面高度按原比例换算宽度三者最小值，高度auto。420×320原生画面最大显示420×320，窄/低屏或剩余高度不足仅等比缩小，不放大、不裁剪。全局弹窗画面保留180px最低操作高度以便低屏滚动到完整画面；QR嵌入保留原有独立槽与viewport约束。帧宽高写入img属性，指针坐标按实际图像矩形映射；后台ROI负责定位原生验证码，不由前端重绘滑块或放大整页截图。
- 标题仅显示账号displayName；不附sellerRef/账号ID，未取得名称时显示“闲鱼账号”，扫码阶段显示“扫码登录的闲鱼账号”。
- 队列、标题、倒计时和结果文本不因帧刷新闪动；新帧替换必须释放旧Blob URL。
- 状态用文字和颜色共同表达；按钮尺寸遵循共享组件，键盘焦点与弹窗焦点圈定保留，错误通过role=alert。
- 默认收起保留“查看验证”入口，不取消后台QR；“取消此次登录”是独立明确动作。

## 交互验收

- 首帧解码、Panel尺寸非零、前台可见、输入WS就绪且未被其他modal遮挡才ACK；倒计时按serverTime校准。
- claim成功后才发送输入，不在按下时缓存并回放尚未授予的手势。倒计时和指针事件不延长30秒。
- pointercancel、关闭、后台与断线释放输入；重连3秒仅恢复原controller，不重置人工截止。
- 服务端clear撤销旧图/ready；可见画面槽等新图时保留同一stream，仍须真实解码图才能ACK或输入。同连接新帧不发resume；真实断流且有reconnectDeadline才恢复controller。旧HTTP ACK和旧decoder不得在clear后恢复ready，新图在旧ACK未完成时加载也不能漏ACK。
- 用户明确claim与租约版本续期冲突时，仅对409/VERIFICATION_VERSION_CHANGED重取同session后最多再发一次。仍为priority、无controller、原presentation属于本client且有效、同连接/stream epoch/geometry、新图新鲜且可见、原priorityDeadline尚未结束才重发；状态/权限/画面变化或再次冲突均停止。不得自动换session、延时限或回放迟到pointerdown。
- 同一时刻只有一个Panel控制实例；QR嵌入时全局只显示入口/队列提示。
- 失败提示保留风险；“验证码通过”不能显示为“账号已连接”；部分来源未恢复显示具体后续操作，写操作不重放。
- 我来重试固定manual_only；只有明确“交给系统”才能允许自动。
- DTO的`autoAllowed`单独表达服务器是否允许自动；仅显式true时显示“交给系统”。false时只显示人工操作，当前人工按钮改为“结束人工”；全局/QR关闭确认显示“结束人工并关闭”，两条路径均发送`release(toAuto:false)`，收到服务端settling后可关闭，不承诺自动接管。
- 显式重试的目标新会话即使立即失败/过期/取消，也持续展示该结果，不被其他账号的updated或重连快照抢走；用户显式切换可解除保留，当前人工控制的优先规则不变。

## 本次修订验证边界

v0.5实现者负责UI规范复用与重试结果选择修复，不能签署其自身的独立UI审核。自动化单元/构建结果由本次交付记录补充；真实React→API→PG→Chrome联调、1440×900/390×844截图与独立规范审核由主Agent和另一审核Agent完成。本文件不把SSR渲染或样式检查当作真实原生验证码放行。

2026-10-26本次窄改实际验证：`apps/web`中`npm run typecheck`、`npm run build`通过，`npm run test`为110文件/528测试通过。新增三条失败/过期/取消结果的连续投影回归，修复前均观察到B被切回A，修复后保持B且当前人工控制仍优先。无API/PG的独立Chrome样式探针另验证DPR2、390px宽图与高图三例，按钮和关闭控件32px、弹窗居中、图像比例及原尺寸上限均符合断言；该探针只证明样式几何，不代替真实React联调。

后续补充`VerificationProvider.browser.test.ts`：真实React Provider/context/队列按钮/WS快照处理的浏览器集成，覆盖显式retry A终态→队列open B→无关updated→snapshot仍保持B；禁自动时覆盖全局关闭、QR关闭、直接结束人工，断言真实组件命令体`toAuto:false`与settling后的展示/关闭。传输与平台结果受控，不连接PG或生产，不替代主Agent的完整链路E2E。

补充后的Web全量结果为111文件/533测试通过（其中4条上述真实React浏览器集成），`npm run typecheck`和`npm run build`通过；本次未修改主Agent拥有的E2E脚本。

v0.6固定高度回归（2026-10-26）：实际React/Chrome、受控WS/JPEG帧与本地合成布局图片，连续验证preparing→420×320画面→断流重连→failed；修改前3个视口初始高度均187.30px，固定高度断言失败。修改后1440×900为640×540，390×844为362×540，390×360为362×304；四状态的外框top/height与画面槽top/height各自保持一致。桌面原图420×320，窄屏309×235.42，低屏265.78×202.5，全部保持比例且不放大。另断言可内部滚动到完整图像、重试按钮与长结果末项，外框不变、页面无横向溢出。全量111文件/536测试通过，Web类型与build通过。尺寸JSON及三个截图保存在本机TEMP的`xianyu-verification-fixed-height*`，不是平台挑战或生产放行证据；布局由主Agent独立审核。

v0.7用户指出普通屏仍有留白/滚动条与冗余账号编号，以上v0.6尺寸是历史证据，不再作为最新内部布局标准。本次仅改布局、终态布局标记与标题，stream/pointer不改；真实React几何断言区分短失败与12项长结果，真实AccountContext→VerificationBridge验证仅显示displayName，Provider未知名称不输出ID。

v0.7实际验证（2026-10-26）：最终`npx vitest run src/features/verification/VerificationProvider.browser.test.ts` **20/20 PASS，25.16s**，`npm run build`（含typecheck）PASS。桌面640×540，验证码420×320；390×844手机362×540，验证码324×246.84；390×360低屏362×304，验证码236.25×180。正常桌面/手机preparing、native、reconnect、shortfailed主体均clientHeight=scrollHeight=439，无二级摘要/结果滚动；普通失败内容槽19.8px，重试与说明紧凑排在结果下。低屏主体203px，完整图像及按钮可滚动到，长结果滚动高度715px且末项可达；全程外框top/height保持不变，无横向溢出。

修前旧CSS原文保存在TEMP，独立同React夹具对照实际FAIL：短失败body439/scroll468、画面槽320。第一版调整后短失败已通过，但新增完整20项中17PASS/3FAIL，暴露reconnect正文仍溢出28px与低屏图不可同时可见；去掉panel的min-height:min-content，保留image自身180px最低高度与body滚动后，最终20/20通过。没有通过关overflow、缩小按钮或放松断言回避失败。

最新几何JSON：`%TEMP%/xianyu-verification-fixed-height.json`；ready与failed三视口截图：`xianyu-verification-fixed-height-{desktop,mobile,low-screen}.png`、各`*-failed.png`。旧CSS前后对照probe及JSON为TEMP的`xianyu-verification-layout-probe.mjs`、`xianyu-verification-layout-before.json`、`-after.json`（该after是第一次短态probe，最终完整几何以fixed-height.json为准）。图片均为本地合成夹具，非真实验证码。实现者不签本人独立UI PASS，主Agent/架构审核继续负责独立检查。用户后续要求核实前端原生控件方案，本次仅保留已授权的标题/布局窄修，不继续扩展截图输入方案。

后续传输修订实际作者浏览器回归14/14：clear跨2秒续期不误断线、同连接新图不resume、旧ACK晚返回不授予旧图控制且新帧不漏ACK；明确claim版本冲突成功最多两次POST，过期/他人presentation/自动状态不重试，连续冲突最多两次。清图与ACK竞态已独立审阅，claim有界重试追加独审中。全部为真实React/Chrome+受控transport/WS，不能替代原生平台滑动。

## 计划证据（尚未执行）

真实React入口→API→隔离PG→原Patchright受控页面拖动→协议结果→业务/凭证持久化，断言页面结果与数据库；另测5秒自动、30秒超时、撤权、重连、QR取消与iframe/触控。固定桌面/触控截图及IAB DOM/可见性核对后填写结果。受控平台证据不冒充生产闲鱼放行成功。
