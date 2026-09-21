# 卡券创建到列表管理端到端证据

日期：2026-09-21（Asia/Shanghai）  
分支：`fix/coupons-create-list-e2e`  
Worktree：`F:\ChenHai\Project\XianYuAgent-coupons-create-list-e2e`

## 验收链路

- Chrome/CDP 通过“新建卡券”弹窗填写唯一卡券名称和固定文字内容。
- 创建请求使用 `AccountContext` 当前可用账号，不再回退到硬编码 `account-001`。
- 保存后断言弹窗关闭、卡券名称和正文预览出现在列表，并通过 MemoryStore 列表复读确认 API 已持久化。
- 在同一条 UI 创建的卡券上完成编辑、复制、禁用、启用、详情、库存导入、受控正文预览、绑定商品和作废。
- 刷新页面后再次断言编辑后的卡券仍在列表，覆盖真实 API 回读与管理状态链路。

## 验证命令

```text
npm run verify
```

结果：通过。包含 API/Web 类型检查、API 全量 smoke、Web 39 个测试文件 / 118 个测试、API/Web 构建、账号 Chrome/CDP E2E、卡券 Chrome/CDP E2E、Compose 配置和 `git diff --check`。

卡券 E2E 输出：

```text
local Chrome E2E passed: UI create -> list -> edit/copy/toggle -> import/bind/void -> reload
```

## 视觉证据

- `screenshots/coupons-create-modal-desktop-1440x900.png`
- `screenshots/coupons-create-modal-mobile-390x844.png`
- `screenshots/coupons-desktop-1440x900.png`
- `screenshots/coupons-mobile-390x844.png`

## 范围说明

本次使用隔离 Chrome、stub API 和 MemoryStore 完成可复现的前后端真实 HTTP 链路；未将预置卡券冒充 UI 创建结果。正式 PostgreSQL/Redis/MinIO 发布级恢复演练仍属于项目既有后续门禁。
