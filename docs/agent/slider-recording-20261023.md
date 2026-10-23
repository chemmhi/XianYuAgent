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
