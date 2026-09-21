# SelectField 真实三态浏览器证据

- 目标页面：`http://127.0.0.1:4173/controls`
- 基准设计稿：`F:\ChenHai\Project\XianYuAgent-search-select-preview\docs\design-preview\xianyu-admin-controls-review.html`
- 浏览器：Chrome headless + DevTools Protocol
- 视口：`1440×900`，`deviceScaleFactor=1`
- 操作方式：真实 CDP 鼠标事件；不是静态 DOM 推断，也不是差异热图替代实现截图

## 三态结果

| 状态 | 结论 | 关键观察 |
| --- | --- | --- |
| 默认 | 通过 | `34px` 高、`7px` 圆角、背景 `rgb(246, 247, 249)`、边框 `rgb(229, 231, 235)` |
| 聚焦 | 通过 | 白底、边框 `rgb(36, 90, 141)`、`2px` outline |
| 展开 | 通过 | `aria-expanded=true`、真实 `.ui-select-menu`、`role=listbox`、3 个选项、1 个选中项、白底、8px 圆角、设计稿浮层阴影 |
| 点击外部 | 通过 | 菜单移除，`aria-expanded=false` |

## 截图

- [默认态](select-default-1440x900.png)
- [聚焦态](select-focus-1440x900.png)
- [展开态](select-open-1440x900.png)
- [机器可读结果](result.json)

## 可复现命令

```powershell
node apps/web/scripts/e2e-selectfield-three-state.mjs
```
