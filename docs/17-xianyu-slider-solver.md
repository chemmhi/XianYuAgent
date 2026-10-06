# 闲鱼滑块算法迁移与部署适配

## 目标

把 `.review-xianyu-super-butler/slider_algorithm` 中的轨迹生成和页面流程迁移到正式 API 服务，复用项目已有的 Chrome/CDP 骨架，不新增 Playwright 运行时依赖。

## 模块边界

- `apps/api/src/xianyu-slider-trajectory.ts`：纯算法模块。输入水平位移，输出带加减速、二维抖动、超调、回弹和每点延迟的 `(x, y, delay)` 轨迹；可注入随机源，便于复现测试。
- `apps/api/src/xianyu-slider-solver.ts`：CDP 页面适配器。负责元素发现、距离计算、鼠标事件回放、成功/失败判定、重试控件点击和页面刷新；不读取业务 Cookie、Token 或数据库。
- `apps/api/src/xianyu-verification-browser.ts`：浏览器生命周期与 Cookie 读取。导航到验证页后，在 `XIANYU_VERIFICATION_SLIDER_MODE=auto` 时调用 solver；自动算法失败会回到原有人工等待流程。
- `apps/api/src/xianyu-qr-login.ts`：保持 `verification_required` 状态机和 Cookie 合并逻辑，不把自动化失败伪造成登录成功。

## 完整流程

```text
QR 登录确认
  -> 闲鱼返回 iframeRedirectUrl
  -> verification_required
  -> Chrome/CDP 打开验证页
  -> (可选) 自动发现主文档/可访问 iframe 的滑块控件
  -> 轨道宽度 - 滑块宽度计算位移
  -> 轨迹生成：加速/减速 + 抖动 + 超调 + 回弹
  -> CDP mousePressed / mouseMoved / mouseReleased
  -> 轮询容器可见性、失败文本和 URL
  -> 成功：读取浏览器 Cookie，继续 QR 登录
  -> 失败：点击重试；没有重试控件则刷新验证页
  -> 达到上限：保留 verification_required，等待人工完成
```

## 配置

```dotenv
XIANYU_VERIFICATION_BROWSER_MODE=launch|connect
XIANYU_VERIFICATION_SLIDER_MODE=disabled|auto
XIANYU_VERIFICATION_SLIDER_MAX_RETRIES=3
XIANYU_VERIFICATION_BROWSER_HEADLESS=false
```

服务器部署时需要 Chrome/Edge 可执行文件和 CDP 端口。`launch` 模式由 API 进程启动浏览器；`connect` 模式连接已有 CDP 浏览器。算法默认关闭，开启后仍保留人工兜底，避免把外部风控状态误判为成功。无头模式适合受控测试或专用验证容器；真实账号建议使用隔离 profile 并进行人工复核。

## 证据与边界

- 已验证轨迹确定性、时间轴回放、CDP 事件顺序、失败重试和受控本地 Chrome/CDP fixture。
- 未宣称真实闲鱼外部风控挑战已通过；真实账号、真实 Cookie、外部页面结构和生产 profile 仍需在受控账号上人工验收。
- 生产复核（2026-10-06）确认：滑块位移为 256px，`/slide` 请求已带 `bx-et`/`bx-pp`，但闲鱼返回 HTTP 200 且业务体为 `code=300, sig=from bx`，页面显示 `验证失败`。因此当前阻断来自外部 BX 风控对自动化交互的拒绝，不是轨道几何或 HTTP 超时；自动模式继续 fail-closed，人工验证仍是恢复路径。
- 跨域 iframe 无法通过主页面 DOM 直接读取；当前实现会处理主文档和可访问 iframe，遇到不可访问跨域 frame 时保留人工流程，不伪造成功。
