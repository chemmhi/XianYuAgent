# 正式前端应用

`apps/web/` 是项目正式的 React + Vite 前端实现目录。

- `SellerAgent/` 仅保留高保真视觉与交互原型，不再作为业务实现目录。
- 正式前端按阶段 3 组件契约组织路由、页面、领域模块、状态和 API adapter。
- 当前迁移范围是阶段 5 S4-VS1 账号管理切片；其他主体功能按阶段 4 计划逐片实现。
- 不复制 `SellerAgent/src/App.tsx` 或 `SellerAgent/src/styles.css` 作为正式前端宿主。
