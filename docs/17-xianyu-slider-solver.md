# 闲鱼滑块验证与部署适配

本文描述当前实现。自动执行器使用固定来源的 Ydisks 轨迹及失败恢复流程；旧物理抖动生成器已删除。

## 模块边界

- `xianyu-slider-ydisks.ts`：移植固定上游的三段锚点、连续事件、550–1050ms 目标时间、4–20px 受控超调及轨道半高的 Y 轴跨度；包含准备动作、计时回放及松手后的确认事件。测试与独立执行上游 Python 生成的参考逐点比较。
- `xianyu-slider-solver.ts`：通过独立 slider port 定位主文档和 iframe，按轨道宽减按钮宽测距；失败后只点击平台重试控件，并确认按钮回到起点 ±3px 后重试，不刷新挑战页。不访问账号数据库。
- `xianyu-slider-verdict.ts`：记录脱敏 `/slide` 返回码。`success=true, code=300` 属于失败；不记录签名、挑战 URL 参数或 Cookie。
- `xianyu-verification-browser.ts`：管理 profile、Cookie 注入、最终完成判定与关闭。仅在页面离开验证态且 `x5sec` 相对输入已更新时返回成功。
- `patchright-verification-browser.ts`：唯一浏览器库适配器，懒加载 Patchright，启动正式版系统 Chrome 的持久化上下文；不连接日常浏览器，不要求开放 CDP 端口。
- `xianyu-browser-im-token.ts`：在同一浏览器中原生请求 Token、完成该请求生成的挑战、轮换签名 Cookie，并校验登录身份。限制最多两种不同挑战，重复同一挑战或预算耗尽即报错。
- QR/IM 服务：QR 使用自身挑战；IM 将恢复的 Token、设备 ID、完整 Cookie 快照一次保存后，再核销同来源风险。IM 连接风险在真实注册成功后处理。

Cookie 快照需保留域、路径、HttpOnly、Secure、SameSite、分区键 `partitionKey` 和 Chromium 的 `_crHasCrossSiteAncestor` 分区标记。字符串 Cookie 头不包含这些属性，不能作为完整浏览器状态；IM 合并同一 Cookie 的值更新时保留已有属性，轮换值不继承旧值的过期时间，浏览器注入传递分区信息。Patchright 遗漏祖先标记时默认按跨站分区注入，实测会改变同站页面的 Cookie 可见性。这些状态修复不代表真实挑战已经通过。

## 当前流程

```text
QR 确认或 IM token 返回需要验证
  -> 按账号/会话串行启动独立持久化 Chrome
  -> 注入 Cookie；IM 原生请求自己的挑战，QR 打开其验证 URL
  -> Ydisks 准备动作，定位滑块（包括 iframe）
  -> 计算 track.width - button.width，生成连续轨迹
  -> Patchright page.mouse 按下、移动、释放，再补确认事件
  -> 失败时点击平台重试控件，确认归位后再试，最多配置次数
  -> 达到上限：返回验证错误，保留可恢复状态
  -> 页面离开验证态 + 新 x5sec：读取 Cookie 并关闭上下文
  -> QR 继续登录；IM 原生获取 Token 并校验身份
  -> IM 一次保存 Cookie 快照、Token、设备 ID，再执行真实连接
```

iframe 通过 Patchright frame API 操作；不能将主页面 JavaScript 的跨域 DOM 限制等同于 Patchright 无法定位跨域 iframe。页面结构、frame 生命周期或平台策略仍可能导致定位/验证失败。

## 配置与默认值

| 配置 | 直接 Node 启动未设置时 / `.env.example` | 生产、开发 Compose 的 API 未覆盖时 |
| --- | --- | --- |
| `XIANYU_VERIFICATION_BROWSER_MODE` | `disabled` | `launch` |
| `XIANYU_VERIFICATION_SLIDER_MODE` | `disabled` | `auto` |
| `XIANYU_VERIFICATION_BROWSER_HEADLESS` | `false` | `false`，Xvfb 虚拟桌面 |
| `XIANYU_VERIFICATION_SLIDER_MAX_RETRIES` | `3` | `3`，可由环境覆盖 |
| `XIANYU_VERIFICATION_BROWSER_MAX_WAIT_MS` | `180000` | `180000` |
| profile 根目录 | 系统临时目录下 `xianyu-agent/browser_data/xianyu-verification` | `/app/browser_data/xianyu-verification`，持久化卷 |

浏览器模式只支持 `disabled|launch`，滑块模式只支持 `disabled|auto`。显式环境值优先；把 `.env.example` 复制为 `.env` 会显式关闭验证，不能仅凭 Compose 默认值推断实际运行状态。

普通 `npm run dev` 继承配置；`dev:api:verification` 与 `dev:worker:verification` 显式启用 `launch + auto`。Compose 中此表描述的是 API 服务，不能假设 Worker 有相同变量或虚拟桌面。

本机使用 Windows 正式版 Chrome；容器固定使用 `/usr/bin/google-chrome`。Ydisks 使用真实 Chrome 默认 UA、原生窗口尺寸及 1920×1080 虚拟桌面；显式 UA 覆盖仍然生效。自动拖动不把窗口移动到屏幕之外。显式 `HEADLESS=true`，或 auto 模式设置 `XIANYU_VERIFICATION_AUTO_HEADLESS=true`，会使用无头模式。

自动模式的正式 QR/IM 调用不回退到人工窗口。失败时可在闲鱼页面手动验证，并在账号管理回写该账号最新完整 Cookie；本地浏览器的 Cookie 不会自动同步到服务端。

## 身份与证据边界

请求侧平台字段从同一 UA 派生；Linux 镜像入口在 Node 启动前读取实际 Chrome 版本，Windows 从安装目录探测版本。自定义 UA/版本覆盖仍需与实际浏览器一致。

本地与服务器复用同一算法，但出口 IP、操作系统、Chrome 版本、图形环境和 profile 状态各自独立。本地通过不能证明生产通过；拖动完成也不能替代新 `x5sec` 和业务接口恢复的证据。

历史记录：2026-10-06 生产曾观察到 `/slide` HTTP 200、业务 `code=300, sig=from bx` 与页面“验证失败”；2026-10-08 合入运行时身份漂移修复 `72d37ae`。这些是当时的观察，不代表当前原因或当前已通过。真实闲鱼挑战必须另行记录实际结果。

开发录制与复现边界见 [本地记录验收](agent/slider-recording-20261023.md)。

2026-10-24 的 23Star/Ydisks 隔离实测见 [专项记录](agent/slider-ydisks-20261024.md)。缺失账号签名 Token 的浏览器即使得到 `code=0` 与新 `x5sec`，也不能作为账号恢复证据；必须复核真实请求 Cookie、账号身份和后续 Token/连接结果。

本次接入正式执行器及真实账号隔离验收见 [2026-10-24 接入记录](operations/ydisks-production-executor-20261024.md)。该验证使用腾讯云出口与生产账号资料副本，凭证写入隔离 PostgreSQL；不代表常驻生产服务已发布或恢复。
