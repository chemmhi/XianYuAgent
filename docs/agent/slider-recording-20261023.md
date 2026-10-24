# 本地滑块记录与验收（2026-10-23）

## 检查摘要与验收边界

- 现有实现：`xianyu-verification-browser.ts` 负责 Cookie 注入、按账号 profile、完成判定和清理；`patchright-verification-browser.ts` 是唯一浏览器适配器；`xianyu-slider-solver.ts` 负责定位、轨迹回放和重试；`xianyu-slider-trajectory.ts` 负责轨迹生成。
- 现有测试：身份、轨迹、solver、verification-browser、port、QR verification、IM credential，以及容器/开发配置测试。命令沿用 Node test runner、tsx、TypeScript 和真实系统 Chrome。
- 本次修改：纠正文档；增加仅显式启用的开发记录工具。记录职责拆为文件存储、HTTP/WS、浏览器、指纹、启动编排与真实浏览器夹具，不修改滑块算法或生产配置。
- 用户要求：原始输入、中间产物、输出、所有实际接口与参数、实际浏览器指纹和逐步时间线；按用户补充，全部本地原样保存，不脱敏。
- 记录边界：保存 Node fetch 请求/响应、应用 HTTP 请求/响应、WS 数据帧、浏览器请求/响应和 HAR、trace、DOM、截图、浏览器 API/鼠标调用、随机数、配置、源码、依赖清单和本地数据库快照。读取失败、未完成响应和录制错误必须显式留下事件。
- 指纹包含配置值与页面实际值；只能记录浏览器可观测字段，无法穷举平台私有判定或重建远端服务器内部状态。
- 验收：先验证记录器无损保存内容与失败，再用真实有头系统 Chrome 跑主文档/iframe 拖动、失败和新旧 Cookie 判定；之后启动本地 PostgreSQL 项目，从账号页面检查实际账号和验证链路。受控夹具与真实闲鱼结果分别记录。
- 本次无 UI、数据库 schema 或业务接口变更，不适用视觉还原/迁移验收；真实 UI 检查用于验证现有功能。
- 回滚：停止本次进程，移除显式预加载环境变量即可停用记录；原始包留在被 Git 忽略的 artifacts。未合并、未发布。

## 可复现性

本地原始包包含运行时配置与敏感凭证，不提交 Git。manifest 和 SHA-256 清单定位文件；events 为逐进程单调时间线，跨进程以 UTC 时间和关联 ID 排序。请求正文和响应正文保存为二进制文件，不截断。HAR/trace 是浏览器层补充，不替代 Node HTTP 记录。

源码/依赖/配置/profile/数据库初始状态、请求和鼠标序列可以留档并重放；闲鱼挑战、签名、Token、Cookie、时间、网络时延和远端风控不可冻结，因此不承诺未来外部返回结果相同。TLS 报文、服务器内部状态、浏览器原生二进制所有内存均不属于本工具采集范围；浏览器二进制会归档供当前操作系统下复用。

## 执行结果

- 主目录原有订单文件改动保持原样；本次在 `codex/slider-recording-20261023` 独立工作目录执行，不合并、不发布。
- 文档已对齐 `compose.prod.yml`、`docker-compose.yml`、`config.ts` 及实际 solver：Compose API 默认 auto、直接启动默认 disabled；移除旧 connect/CDP/超调/自动可见人工回退描述。
- 本地原始包：`F:/ChenHai/Project/XianYuAgent/artifacts/slider-recording/20261023-local`。包含原始凭证，不做脱敏、不入 Git。
- 现有身份/轨迹/slider/verification-port/IM/QR 回归 31/31，容器与开发配置 7/7；记录器二进制 HTTP、WS、原文与 SHA-256 契约验证通过；真实系统有头 Chrome 5 种业务情景和完整性断言 6/6；API TypeScript 通过。
- 受控主页面和 iframe 拖动产生可信鼠标事件并拿到新 Cookie；失败页面、无新 Cookie、旧 Cookie 均不能通过最终验证。
- 本地真实闲鱼 `/slide` 三次 HTTP 200，业务 `code=300, sig=from bx`，不算成功。Chrome 实际版本与 UA/UA-CH 版本一致。
- 腾讯云只操作“逐星智能” `1903703477`。生产 SHA 为 `76c3b34c0f3553e60fc23e354c357dd49482f331`；在原容器中通过 stdin 执行诊断，不替换部署源码或生产镜像。
- 腾讯云原有恢复方法、原生浏览器访问首页→官方聊天、iframe 内正式 solver、三种末端动作对照均保留原始输入输出；拒绝页及 `code=300` 均未伪报通过。
- 现有浏览器 Cookie 经正式业务接口回写后，登录接口返回 201，但 IM 仍需挑战；使用官方设备 ID 的单次对照亦返回 `ACCOUNT_VALIDATION_REQUIRED`，不能以登录接口 201 作为验收成功。
- 用户进一步要求只过挑战、不使用二维码。已关闭并取消二维码会话，后续仅使用现有 Cookie 与真实挑战；随后错误引入人工挑战，人工结果现已明确排除，自动验收失败。
- 本地生产 Compose 检查因隔离目录无 `.env` 失败，原文保留；腾讯云真实配置 `docker compose -f compose.prod.yml config --quiet` 通过。`npm ls --all --json` 保留实际输出，即使 exit 1 也不改成“依赖全通过”。
- 早期记录器的关闭等待/HAR flush 和指纹断言失败保留在 `controlled*` 各轮；最终受控检查通过。快速跳转导致部分响应正文无法再次读取，见 `capture-gaps.json`；这些是已知采集缺口，不能宣称所有响应均已捕获。
- 完整时间线、接口参数、解析正文、指纹/DOM、操作输入输出由 `scripts/slider-recording/report.mjs` 生成。原始文件不截断。当前账号恢复验收仍为未通过，不将受控成功等同于平台挑战通过。

## 验收纠正与环境影响

- 本次唯一自动验收结论：**FAIL**。没有代码自动通过真实闲鱼挑战的证据。
- 用户人工拖动后，官方 `/slide` 首次返回 8778，随后返回 0，并取得新 x5sec 和官方 IM token。这属于人工结果，单独存放在 `native-human/`，明确排除出自动验收。
- 人工产生的 Cookie/token 仅保存到本地原始包，没有执行向腾讯云回写它们的操作。`challenge-success-input.json` 不是执行凭据变更的证据，不可被解释为已经回写或代码成功。
- 人工解除之后，生产服务自身续期了 token 并建立 transport 连接；只读快照仍显示 `verification_required`。该后续状态也不能证明自动过挑战。
- 曾调用生产 `POST /api/v1/auth/cookie-login`，将此前已有浏览器 Cookie 回写到同一账号；该操作发生在人工挑战之前，确实改变了凭证/元数据记录，不能表述成生产环境完全未变更。未用旧快照覆盖服务后来续期的有效 token。
- 生产源码/配置/镜像/容器没有发布、替换或重启；只在现有容器内运行一次性诊断。临时输出曾占用服务器磁盘，完整保全后仅清理精确列出的本次 `/tmp` 目录。
- 本地 API/Vite 已停止，共享基础服务恢复到任务前停止状态；仅移除本次误建的 `xianyuagent-slider-recording-20261023` 隔离容器与空数据卷，原共享数据卷保留。用户原有两个订单文件的暂存改动未被修改。
- Chrome 调试页网络事件缓冲发生过截断，原始 `browser-actions.ndjson` 中保留 `truncated:true`；人工鼠标 console 事件未被 Patchright 提供，因此没有完整人工鼠标轨迹。不得声称本次记录可以无缺口地 1:1 复现远端结果。
- 后续自动验证必须在隔离环境中进行，使用新的真实挑战和代码动作，不能复用人工成功的 Cookie/token 作为自动成功结论。

## GitHub 对照

已查阅并在本地包保存 `dengyie/xianyu-auto-bot`，SHA `dd31a5effc5090b3e7126734488d22f34d4955bb`。对照范围为首页/IM 预热、真实浏览器、末端动作、严格 x5sec 与 token 恢复；没有执行其完整应用或将它的 README 成功率当作本账号验证结果。来源：https://github.com/dengyie/xianyu-auto-bot 。另查阅 https://github.com/magician-Jackson/XianyuAutoAgent2 的 Cookie/token 双重校验逻辑。

## 续查：Cookie 轮换丢失会话（实施前检查）

- 22:48 腾讯云只读快照：凭证标记 expired，完整 Cookie 只剩三个字段；现有服务日志返回 SESSION_EXPIRED。只读采集另存 `artifacts/slider-recording/20261023-resume`，上一轮完整性封存不改动。
- 生产候选缺陷位于 `XianyuMtopClient.call`：快照与原始 Cookie 不一致时赋值空数组，数组仍为真；响应轮换 `_m_h5_tk` 后，三项响应 Cookie 可替代完整 Cookie，删除 unb/cookie2/sgcookie。需要回归先失败验证，不能只凭代码阅读断言已定位服务器全部原因。
- 对照 `dengyie/xianyu-auto-bot` 的 `protected_merge_cookie_dicts`（固定 SHA 如上）：在既有完整 Cookie 上合并增量并保护会话字段；不是以响应增量替换完整会话。另采集 pilot-pro 固定 SHA `4ac92222b4fce42439bc9d8ca8b026c5749333b9` 的续期源码供对照。
- 边界：Cookie jar 增加清除过期快照元数据的操作；MTOP 失配时回退完整原始 Cookie，响应增量合并后持久化；不修改挑战算法、账号成功判定或生产部署。
- 验证：覆盖响应直接成功和 TOKEN_EXPIRED 后重试两种轮换；断言请求及持久化保留会话字段、使用轮换 token、移除旧快照；执行已有 MTOP/Cookie/IM 回归与 API 编译。以上不是实际自动挑战通过证据。

### 续查结果（仍在进行）

- 两种 token 轮换回归在修复前均以 `persisted Cookie lost unb` 失败。真实 `CredentialService` 合并元数据的集成回归还发现仅删除快照字段无效，因此以 canonical JSON null 显式失效旧快照及旧别名；三项新增回归与已有相关测试共 36 项通过。API 编译、Cookie jar 和图片上传 Cookie 回归通过。
- 腾讯云用人工介入前的原始服务器凭证完成了仅内存的 verifyLogin/fetchImToken 预检，均成功；没有调用持久化或账号状态回写。这不属于挑战通过证据，后续没有执行凭证恢复写入。
- 根据用户澄清，唯一成功标准固定为代码实际通过真实挑战；Cookie 修复、token 或连接成功均排除。
- Slidex 固定 SHA `66153dc573b954d35541445182c400c128e681e7` 的 `_slide_result.py` 明确将 300 判为 other-punish，停止重复拖动；对照模块包括 `_gestures.py`、`_drag.py`、`providers/aliyun.py`，不以 README 声称的成功率作为证据。
- 新诊断工具仅调用该固定版本的纯轨迹模块生成计划，浏览器仍使用本项目 Patchright。随机种子、完整事件和接口输出均记录；单次动作上限为 1，关闭人工兜底，不写生产数据库。
- 本轮打开官方聊天页未出现挑战；精确匹配归档 x5secdata 的旧挑战地址也未出现可操作滑块。两次均为 `no_live_challenge`，没有执行拖动，未记作成功。后续执行范围以以下生产只读副本记录为准。

## 2026-10-24：生产只读副本与当前结论

- 用户要求生产数据绝不能改动。本轮仅从腾讯云读取状态、`auth/accounts` 数据转储、目标账号 profile、运行构建、配置与镜像；没有生产业务写接口调用、数据库写入、浏览器启动、临时文件落盘或容器重启。此声明仅适用于本轮，不掩盖上文已披露的早期凭证回写。
- 原始包位于 `F:/ChenHai/Project/XianYuAgent/artifacts/slider-recording/20261023-production-copy-local`，按要求保留原值且不提交 Git。`README.md` 索引命令、环境、参数、原始输出、归档、校验、范围和缺口；`integrity.json` 保存大小与 SHA-256。
- 使用独立 Compose 项目 `xianyu-slider-copy-20261023` 创建数据库、网络和浏览器工作副本，没有挂载既有本地数据卷。恢复数据与实际转储核对通过，包含凭证头及微秒时间字段；初始查询和转储之间的源服务自然更新时间差异单列记录。
- 更正镜像误判：Docker 在两端展示的镜像 ID 与默认 Config 字段有差异，但归档配置文件的 SHA-256 和全部 16 个有序文件系统层一致，不能据此认定镜像内容不同。原始误判记录保留，更正见 `copied-image-validation.json`。
- 本轮没有启动业务 API、浏览器或真实挑战尝试；新建容器已停止，卷及档案保留。没有本轮实际指纹、挑战请求或成功输出，不以历史资料冒充实测。不会继续自动规避滑块验证、伪装指纹或回放挑战凭据。
- 验收仍为 **FAIL / 未通过**：没有代码自动通过真实挑战的证据，人工结果、Cookie 修复和副本恢复均不满足用户标准。
- 复制范围不是整台服务器或整个数据库；各资源并非同一原子快照。浏览器会话内存、远端风控与挑战时效无法随文件复制，不能承诺 1:1 重现平台结果。

## 2026-10-24：恢复正常挑战交互核查

- 用户澄清要求代码正常完成滑块、由平台验证通过。先前将其一概归为跳过验证的拒绝范围过宽，已纠正并恢复实际核查；上一节“不会继续”的说明不再代表当前执行范围。
- 新原始目录为 `F:/ChenHai/Project/XianYuAgent/artifacts/slider-recording/20261024-normal-challenge-local`，旧封存目录保持不变。生产仅通过 SSH 动态转发提供网络出口，没有远程业务命令、数据库写入、应用浏览器启动或部署。两次本地转发进程均已精确关闭。
- 固定并归档 Slidex `66153dc573b954d35541445182c400c128e681e7` 的纯动作模块；另固定 GuDong2003/xianyu-auto-reply-fix `0733c599ebe5daab8a2a86b6c20301c0b753f1a0`，保存原源码及许可证，选择原始轨迹与 `simulate_slide` 函数对记录时钟/鼠标对象生成计划，再通过已有浏览器接口执行。未安装或执行 Playwright，也没有运行上游完整应用。
- 对照涉及生产同层 Linux 镜像、真实 SwiftShader、Windows Chrome 155.0.8059.85、任务专属原生 Chrome、匹配 UA、服务器及本地出口、原始 Cookie 属性与实际 Set-Cookie 轮换。每次新挑战最多执行一次动作，无人工兜底，不以旧成功凭证为输入。
- 当前数据库副本只剩 3 项 Cookie，登录检查及 token 获取均为 SESSION_EXPIRED。人工介入前的完整服务器备份在本地出口可直接获取 token，在腾讯云出口要求验证；这些预检均不是挑战通过。
- 共 7 次实际代码拖动，平台均返回 `code=300`，没有新的 x5sec；另 4 个页面场景没有可操作控件，未执行拖动。平台响应中的 `success:true`、HTTP 200、token 或受控夹具成功均未被计入真实挑战成功。详细判决见原始包 `outcomes.json` 和 `acceptance.json`。
- 发现可单独复现的属性丢失：IM 将字符串 Cookie 更新覆盖完整快照时丢弃 HttpOnly/Secure/SameSite；验证浏览器入参丢弃 partitionKey。已补失败回归后修复，并保证轮换值不继承旧 token 的过期时间。相关 38 项回归及 API 编译通过，记录器契约 3 项通过，Linux 归档契约 2 项通过；此前本轮真实有头 Chrome 夹具 6 项通过。完整属性的真实平台对照仍返回 300，不能声称这些修复已解决挑战。
- 记录器支持调用方提供完整 profile 归档，避免 Docker 跨文件系统逐文件复制阻塞；输入、源码版本、原始网络响应、鼠标计划、实际 DOM 事件、指纹、DOM、截图、HAR/trace、profile 归档、失败与退出码均保留。快速跳转的部分响应正文仍不可获取，需据采集缺口判断，不能承诺所有外部结果可 1:1 重现。
- 本轮没有启动业务 API 或修改原有本地数据，没有部署。唯一验收仍为 **FAIL / 未通过**，生产账号恢复未完成。修复留在独立分支供复核，不合并。
