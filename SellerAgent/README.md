# XianyuSellerAgent UI Prototype

基于 xianyu-admin-design-style 设计规范生成的当前产品 UI 原型，参考 docs/prototypes/static-product/index.html、docs/PRD.md 与 xianyu-admin-design-style/assets/design-tokens.json。

## 架构入口

- 页面与接口分层说明：`docs/ARCHITECTURE.md`
- 导航模型：`src/app/navigation.ts`
- 领域契约：`src/api/contracts.ts`
- mock/live API 门面：`src/api/index.ts`

默认使用 mock 数据，当前页面无需启动后端即可交互。接入参考项目的 `backend-web` 时：

```powershell
$env:VITE_API_MODE = 'live'
$env:VITE_API_BASE_URL = 'http://localhost:8089'
```

## 实时预览

1. cd SellerAgent
2. npm install
3. npm run dev

浏览器访问 Vite 输出的本地地址即可实时预览；修改 src/App.tsx 或 src/styles.css 会自动热更新。

## Figma 导入准备

- 原型为静态 React + CSS + 内联 SVG 组件，无后端依赖。
- 颜色、字号、卡片、导航、图表和移动端布局均使用语义 token，便于后续映射到 Figma styles / variables。
- 页面包含桌面控制台与 390px 移动端构图，可通过顶部 桌面控制台 / 移动端 / 登录初始化 切换查看。
- 敏感字段仅展示 credential_ref 或脱敏摘要，不包含 Cookie、Token、API Key、夸克链接或提取码明文。
