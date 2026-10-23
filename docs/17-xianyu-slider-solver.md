# 闲鱼滑块验证与部署适配

本文描述当前实现。旧的裸 CDP、`connect` 模式、越界超调轨迹和自动失败后可见人工窗口均已移除。

## 模块边界

- `xianyu-slider-trajectory.ts`：输入水平位移与可选随机源，输出 `(x, y, delay)`、时间轴和元数据。采用加减速、轨道内二维抖动与末端微调，x 不超过目标距离。
- `xianyu-slider-solver.ts`：通过独立 slider port 定位主文档和 iframe 的元素，按两个右边缘之差计算距离，回放鼠标、探测页面结果、点击重试或刷新。不访问账号数据库。
- `xianyu-verification-browser.ts`：管理 profile、Cookie 注入、最终完成判定与关闭。仅在页面离开验证态且 `x5sec` 相对输入已更新时返回成功。
- `patchright-verification-browser.ts`：唯一浏览器库适配器，懒加载 Patchright，启动正式版系统 Chrome 的持久化上下文；不连接日常浏览器，不要求开放 CDP 端口。
- QR/IM 服务：提供挑战 URL 与 Cookie，成功后合并并保存新凭证；IM 随后重新调用 token 接口确认恢复。

## 当前流程

```text
QR 确认或 IM token 返回需要验证
  -> 取该挑战 URL 和对应会话 Cookie
  -> 按账号/会话串行启动独立持久化 Chrome
  -> 注入 Cookie，打开验证 URL
  -> auto 模式定位滑块（包括 iframe）
  -> 计算 trackRight - buttonRight，生成轨迹
  -> Patchright page.mouse 按下、移动、释放
  -> 失败时点击重试控件或刷新，最多配置次数
  -> 达到上限：返回验证错误，保留可恢复状态
  -> 页面离开验证态 + 新 x5sec：读取 Cookie 并关闭上下文
  -> QR 继续登录；IM 保存 Cookie 并重新申请 token
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

本机使用 Windows 正式版 Chrome；容器固定使用 `/usr/bin/google-chrome`。默认窗口隐藏不等于 headless。显式 `HEADLESS=true`，或 auto 模式设置 `XIANYU_VERIFICATION_AUTO_HEADLESS=true`，会使用无头模式。

自动模式的正式 QR/IM 调用不回退到人工窗口。失败时可在闲鱼页面手动验证，并在账号管理回写该账号最新完整 Cookie；本地浏览器的 Cookie 不会自动同步到服务端。

## 身份与证据边界

请求侧平台字段从同一 UA 派生；Linux 镜像入口在 Node 启动前读取实际 Chrome 版本，Windows 从安装目录探测版本。自定义 UA/版本覆盖仍需与实际浏览器一致。

本地与服务器复用同一算法，但出口 IP、操作系统、Chrome 版本、图形环境和 profile 状态各自独立。本地通过不能证明生产通过；拖动完成也不能替代新 `x5sec` 和业务接口恢复的证据。

历史记录：2026-10-06 生产曾观察到 `/slide` HTTP 200、业务 `code=300, sig=from bx` 与页面“验证失败”；2026-10-08 合入运行时身份漂移修复 `72d37ae`。这些是当时的观察，不代表当前原因或当前已通过。真实闲鱼挑战必须另行记录实际结果。

开发录制与复现边界见 [本地记录验收](agent/slider-recording-20261023.md)。
