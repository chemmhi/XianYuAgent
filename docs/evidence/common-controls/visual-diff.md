# Common Controls Visual Diff

- 生成时间：2026-09-21T13:10:20.941Z
- 源设计稿：`F:\ChenHai\Project\XianYuAgent-search-select-preview\docs\design-preview\xianyu-admin-controls-review.html`
- 基线副本与源设计稿 SHA-256：`85882CAE536AA2B1B2A11344EFF4178DC3744EE35F5C41BD42ABFDE2038A6040`
- 基线：`http://127.0.0.1:56265/xianyu-admin-controls-baseline.html`
- 实现：`http://127.0.0.1:5173/controls`
- 浏览器：Chrome/CDP，deviceScaleFactor=1
- 固定视口：`1440×900`、`390×844`
- 像素差异阈值：每通道 > 16

## 截图差异

| 视口 | 基线 | 实现 | 差异热图 | 尺寸 | changed (> threshold) | mean abs RGB | bbox |
| --- | --- | --- | --- | --- | ---: | ---: | --- |
| desktop | [baseline](controls-baseline-desktop-1440x900.png) | [implementation](controls-implementation-desktop-1440x900.png) | [diff](controls-diff-desktop-1440x900.png) | 1440×900 / 1440×900 | 155827 (12.024%) | 9.206087 | 1409×870 @ 28,30 |
| mobile | [baseline](controls-baseline-mobile-390x844.png) | [implementation](controls-implementation-mobile-390x844.png) | [diff](controls-diff-mobile-390x844.png) | 390×844 / 390×844 | 57969 (17.611%) | 12.690441 | 375×830 @ 12,14 |

## DOM 样式指标

### desktop · 1440×900

#### 基线

### search `.ui-search-control`
| # | rect | background | border | radius | font | padding | shadow |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | 220.0×34.0 @ 296.0,313.9 | rgb(246, 247, 249) | rgb(229, 231, 235) | 7px | 12px / 400 | 0px 10px | none |
| 2 | 220.0×34.0 @ 528.0,313.9 | rgb(255, 255, 255) | rgb(36, 90, 141) | 7px | 12px / 400 | 0px 10px | rgba(36, 90, 141, 0.09) 0px 0px 0px 3px |
| 3 | 220.0×34.0 @ 296.0,381.9 | rgb(246, 247, 249) | rgb(229, 231, 235) | 7px | 12px / 400 | 0px 10px | none |
| 4 | 220.0×34.0 @ 528.0,381.9 | rgb(246, 247, 249) | rgb(229, 231, 235) | 7px | 12px / 400 | 0px 10px | none |
| 5 | 316.0×34.0 @ 666.5,1670.6 | rgb(246, 247, 249) | rgb(229, 231, 235) | 7px | 12px / 400 | 0px 10px | none |
### select `.ui-select-control`
| # | rect | background | border | radius | font | padding | shadow |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | 150.0×34.0 @ 850.5,313.9 | rgba(0, 0, 0, 0) | rgb(17, 24, 39) | 0px | 12px / 400 | 0px | none |
| 2 | 150.0×34.0 @ 1012.5,313.9 | rgba(0, 0, 0, 0) | rgb(17, 24, 39) | 0px | 12px / 400 | 0px | none |
| 3 | 150.0×34.0 @ 1174.5,313.9 | rgba(0, 0, 0, 0) | rgb(17, 24, 39) | 0px | 12px / 400 | 0px | none |
| 4 | 220.0×34.0 @ 850.5,381.9 | rgba(0, 0, 0, 0) | rgb(17, 24, 39) | 0px | 12px / 400 | 0px | none |
| 5 | 154.0×34.0 @ 666.5,1712.6 | rgba(0, 0, 0, 0) | rgb(17, 24, 39) | 0px | 12px / 400 | 0px | none |
| 6 | 154.0×34.0 @ 828.5,1712.6 | rgba(0, 0, 0, 0) | rgb(17, 24, 39) | 0px | 12px / 400 | 0px | none |
### input `.ui-input`
| # | rect | background | border | radius | font | padding | shadow |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | 502.5×34.0 @ 296.0,668.6 | rgb(246, 247, 249) | rgb(229, 231, 235) | 7px | 12px / 400 | 7px 10px | none |
| 2 | 502.5×34.0 @ 296.0,757.6 | rgb(246, 247, 249) | rgb(229, 231, 235) | 7px | 12px / 400 | 7px 10px | none |
| 3 | 502.5×34.0 @ 296.0,846.6 | rgb(255, 255, 255) | rgb(36, 90, 141) | 7px | 12px / 400 | 7px 10px | rgba(36, 90, 141, 0.09) 0px 0px 0px 3px |
| 4 | 502.5×34.0 @ 296.0,911.6 | rgb(246, 247, 249) | rgb(229, 231, 235) | 7px | 12px / 400 | 7px 10px | none |
### textarea `.ui-textarea`
| # | rect | background | border | radius | font | padding | shadow |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | 502.5×84.0 @ 850.5,668.6 | rgb(246, 247, 249) | rgb(229, 231, 235) | 7px | 12px / 400 | 9px 10px | none |
| 2 | 502.5×84.0 @ 850.5,809.6 | rgb(255, 255, 255) | rgb(36, 90, 141) | 7px | 12px / 400 | 9px 10px | rgba(36, 90, 141, 0.09) 0px 0px 0px 3px |
### button `.ui-button`
| # | rect | background | border | radius | font | padding | shadow |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | 91.0×32.0 @ 296.0,1055.3 | rgb(255, 255, 255) | rgb(229, 231, 235) | 8px | 11px / 700 | 0px 12px | none |
| 2 | 91.0×32.0 @ 395.0,1055.3 | rgb(36, 90, 141) | rgb(36, 90, 141) | 8px | 11px / 700 | 0px 12px | none |
| 3 | 70.0×32.0 @ 494.0,1055.3 | rgba(0, 0, 0, 0) | rgb(229, 231, 235) | 8px | 11px / 700 | 0px 12px | none |
| 4 | 70.0×32.0 @ 572.0,1055.3 | rgb(255, 255, 255) | rgba(180, 35, 24, 0.2) | 8px | 11px / 700 | 0px 12px | none |
| 5 | 70.0×32.0 @ 650.0,1055.3 | rgb(255, 255, 255) | rgb(229, 231, 235) | 8px | 11px / 700 | 0px 12px | none |
### placeholder `.placeholder-cell`
| # | rect | background | border | radius | font | padding | shadow |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | 225.2×28.0 @ 830.5,1270.9 | rgb(247, 250, 252) | rgb(216, 228, 239) | 6px | 11px / 400 | 0px 9px | none |
| 2 | 270.3×28.0 @ 1067.7,1270.9 | rgba(0, 0, 0, 0) | rgb(203, 213, 225) | 6px | 11px / 400 | 0px 9px | none |
| 3 | 270.3×28.0 @ 311.0,1327.4 | rgba(0, 0, 0, 0) | rgb(203, 213, 225) | 6px | 11px / 400 | 0px 9px | none |
| 4 | 225.2×28.0 @ 593.3,1327.4 | rgba(0, 0, 0, 0) | rgb(203, 213, 225) | 6px | 11px / 400 | 0px 9px | none |
| 5 | 225.2×28.0 @ 830.5,1327.4 | rgba(0, 0, 0, 0) | rgb(203, 213, 225) | 6px | 11px / 400 | 0px 9px | none |
| 6 | 270.3×28.0 @ 1067.7,1327.4 | rgba(0, 0, 0, 0) | rgb(203, 213, 225) | 6px | 11px / 400 | 0px 9px | none |
| 7 | 225.2×28.0 @ 830.5,1383.9 | rgb(247, 250, 252) | rgb(216, 228, 239) | 6px | 11px / 400 | 0px 9px | none |
| 8 | 62.9×28.0 @ 919.6,1814.6 | rgb(247, 250, 252) | rgb(216, 228, 239) | 6px | 11px / 400 | 0px 9px | none |
| 9 | 154.0×28.0 @ 666.5,1910.6 | rgba(0, 0, 0, 0) | rgb(203, 213, 225) | 6px | 11px / 400 | 0px 9px | none |
| 10 | 154.0×28.0 @ 828.5,1910.6 | rgba(0, 0, 0, 0) | rgb(203, 213, 225) | 6px | 11px / 400 | 0px 9px | none |

#### 实现

### search `.ui-search-control`
| # | rect | background | border | radius | font | padding | shadow |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | 220.0×34.0 @ 296.0,299.1 | rgb(246, 247, 249) | rgb(229, 231, 235) | 7px | 12px / 400 | 0px 10px | none |
| 2 | 220.0×34.0 @ 528.0,299.1 | rgb(255, 255, 255) | rgb(36, 90, 141) | 7px | 12px / 400 | 0px 10px | rgba(36, 90, 141, 0.09) 0px 0px 0px 3px |
| 3 | 220.0×34.0 @ 296.0,365.1 | rgb(246, 247, 249) | rgb(229, 231, 235) | 7px | 12px / 400 | 0px 10px | none |
| 4 | 220.0×34.0 @ 528.0,365.1 | rgb(246, 247, 249) | rgb(229, 231, 235) | 7px | 12px / 400 | 0px 10px | none |
### select `.ui-select-control`
| # | rect | background | border | radius | font | padding | shadow |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | 150.0×34.0 @ 850.5,299.1 | rgba(0, 0, 0, 0) | rgb(17, 24, 39) | 0px | 12px / 400 | 0px | none |
| 2 | 150.0×34.0 @ 1012.5,299.1 | rgba(0, 0, 0, 0) | rgb(17, 24, 39) | 0px | 12px / 400 | 0px | none |
| 3 | 150.0×34.0 @ 1174.5,299.1 | rgba(0, 0, 0, 0) | rgb(17, 24, 39) | 0px | 12px / 400 | 0px | none |
### input `.ui-input`
| # | rect | background | border | radius | font | padding | shadow |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | 502.5×34.0 @ 296.0,532.3 | rgb(246, 247, 249) | rgb(229, 231, 235) | 7px | 12px / 400 | 7px 10px | none |
| 2 | 502.5×34.0 @ 296.0,625.3 | rgb(246, 247, 249) | rgb(229, 231, 235) | 7px | 12px / 400 | 7px 10px | none |
| 3 | 502.5×34.0 @ 296.0,718.3 | rgb(255, 255, 255) | rgb(36, 90, 141) | 7px | 12px / 400 | 7px 10px | rgba(36, 90, 141, 0.09) 0px 0px 0px 3px |
| 4 | 502.5×34.0 @ 296.0,788.3 | rgb(246, 247, 249) | rgb(229, 231, 235) | 7px | 12px / 400 | 7px 10px | none |
### textarea `.ui-textarea`
| # | rect | background | border | radius | font | padding | shadow |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | 502.5×84.0 @ 850.5,532.3 | rgb(246, 247, 249) | rgb(229, 231, 235) | 7px | 12px / 400 | 9px 10px | none |
| 2 | 502.5×84.0 @ 850.5,675.3 | rgb(255, 255, 255) | rgb(36, 90, 141) | 7px | 12px / 400 | 9px 10px | rgba(36, 90, 141, 0.09) 0px 0px 0px 3px |
### button `.ui-button`
| # | rect | background | border | radius | font | padding | shadow |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | 196.0×36.0 @ 43.0,245.4 | rgba(36, 90, 141, 0.5) | rgb(255, 255, 255) rgb(255, 255, 255) rgb(255, 255, 255) rgb(36, 90, 141) | 6px | 11px / 700 | 0px 12px | none |
| 2 | 196.0×36.0 @ 43.0,285.4 | rgba(0, 0, 0, 0) | rgba(255, 255, 255, 0.45) rgba(255, 255, 255, 0.45) rgba(255, 255, 255, 0.45) rgba(0, 0, 0, 0) | 6px | 11px / 700 | 0px 12px | none |
| 3 | 196.0×36.0 @ 43.0,325.4 | rgba(0, 0, 0, 0) | rgba(255, 255, 255, 0.45) rgba(255, 255, 255, 0.45) rgba(255, 255, 255, 0.45) rgba(0, 0, 0, 0) | 6px | 11px / 700 | 0px 12px | none |
| 4 | 70.0×32.0 @ 296.0,933.5 | rgb(255, 255, 255) | rgb(229, 231, 235) | 8px | 11px / 700 | 0px 12px | none |
| 5 | 70.0×32.0 @ 374.0,933.5 | rgb(255, 255, 255) | rgb(229, 231, 235) | 8px | 11px / 700 | 0px 12px | none |
| 6 | 70.0×32.0 @ 452.0,933.5 | rgb(255, 255, 255) | rgb(229, 231, 235) | 8px | 11px / 700 | 0px 12px | none |
| 7 | 70.0×32.0 @ 530.0,933.5 | rgb(255, 255, 255) | rgb(229, 231, 235) | 8px | 11px / 700 | 0px 12px | none |
| 8 | 70.0×32.0 @ 608.0,933.5 | rgb(255, 255, 255) | rgb(229, 231, 235) | 8px | 11px / 700 | 0px 12px | none |
### placeholder `.placeholder-cell`
| # | rect | background | border | radius | font | padding | shadow |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | 238.3×28.0 @ 838.5,1109.6 | rgb(247, 250, 252) | rgb(216, 228, 239) | 6px | 11px / 400 | 0px 9px | none |
| 2 | 238.3×28.0 @ 1104.8,1109.6 | rgba(0, 0, 0, 0) | rgb(203, 213, 225) | 6px | 11px / 400 | 0px 9px | none |
| 3 | 238.3×28.0 @ 306.0,1189.6 | rgba(0, 0, 0, 0) | rgb(203, 213, 225) | 6px | 11px / 400 | 0px 9px | none |
| 4 | 238.3×28.0 @ 572.3,1189.6 | rgba(0, 0, 0, 0) | rgb(203, 213, 225) | 6px | 11px / 400 | 0px 9px | none |
| 5 | 238.3×28.0 @ 838.5,1189.6 | rgba(0, 0, 0, 0) | rgb(203, 213, 225) | 6px | 11px / 400 | 0px 9px | none |
| 6 | 238.3×28.0 @ 1104.8,1189.6 | rgba(0, 0, 0, 0) | rgb(203, 213, 225) | 6px | 11px / 400 | 0px 9px | none |

### mobile · 390×844

#### 基线

### search `.ui-search-control`
| # | rect | background | border | radius | font | padding | shadow |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | 220.0×34.0 @ 40.0,364.4 | rgb(246, 247, 249) | rgb(229, 231, 235) | 7px | 12px / 400 | 0px 10px | none |
| 2 | 220.0×34.0 @ 40.0,430.4 | rgb(255, 255, 255) | rgb(36, 90, 141) | 7px | 12px / 400 | 0px 10px | rgba(36, 90, 141, 0.09) 0px 0px 0px 3px |
| 3 | 220.0×34.0 @ 40.0,498.4 | rgb(246, 247, 249) | rgb(229, 231, 235) | 7px | 12px / 400 | 0px 10px | none |
| 4 | 220.0×34.0 @ 40.0,564.4 | rgb(246, 247, 249) | rgb(229, 231, 235) | 7px | 12px / 400 | 0px 10px | none |
| 5 | 221.0×34.0 @ 77.0,2701.2 | rgb(246, 247, 249) | rgb(229, 231, 235) | 7px | 12px / 400 | 0px 10px | none |
### select `.ui-select-control`
| # | rect | background | border | radius | font | padding | shadow |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | 150.0×34.0 @ 40.0,739.3 | rgba(0, 0, 0, 0) | rgb(17, 24, 39) | 0px | 12px / 400 | 0px | none |
| 2 | 150.0×34.0 @ 40.0,805.3 | rgba(0, 0, 0, 0) | rgb(17, 24, 39) | 0px | 12px / 400 | 0px | none |
| 3 | 150.0×34.0 @ 40.0,871.3 | rgba(0, 0, 0, 0) | rgb(17, 24, 39) | 0px | 12px / 400 | 0px | none |
| 4 | 220.0×34.0 @ 40.0,939.3 | rgba(0, 0, 0, 0) | rgb(17, 24, 39) | 0px | 12px / 400 | 0px | none |
| 5 | 106.5×34.0 @ 77.0,2743.2 | rgba(0, 0, 0, 0) | rgb(17, 24, 39) | 0px | 12px / 400 | 0px | none |
| 6 | 106.5×34.0 @ 191.5,2743.2 | rgba(0, 0, 0, 0) | rgb(17, 24, 39) | 0px | 12px / 400 | 0px | none |
### input `.ui-input`
| # | rect | background | border | radius | font | padding | shadow |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | 295.0×34.0 @ 40.0,1237.2 | rgb(246, 247, 249) | rgb(229, 231, 235) | 7px | 12px / 400 | 7px 10px | none |
| 2 | 295.0×34.0 @ 40.0,1326.2 | rgb(246, 247, 249) | rgb(229, 231, 235) | 7px | 12px / 400 | 7px 10px | none |
| 3 | 295.0×34.0 @ 40.0,1415.2 | rgb(255, 255, 255) | rgb(36, 90, 141) | 7px | 12px / 400 | 7px 10px | rgba(36, 90, 141, 0.09) 0px 0px 0px 3px |
| 4 | 295.0×34.0 @ 40.0,1480.2 | rgb(246, 247, 249) | rgb(229, 231, 235) | 7px | 12px / 400 | 7px 10px | none |
### textarea `.ui-textarea`
| # | rect | background | border | radius | font | padding | shadow |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | 295.0×84.0 @ 40.0,1656.0 | rgb(246, 247, 249) | rgb(229, 231, 235) | 7px | 12px / 400 | 9px 10px | none |
| 2 | 295.0×84.0 @ 40.0,1797.0 | rgb(255, 255, 255) | rgb(36, 90, 141) | 7px | 12px / 400 | 9px 10px | rgba(36, 90, 141, 0.09) 0px 0px 0px 3px |
### button `.ui-button`
| # | rect | background | border | radius | font | padding | shadow |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | 91.0×32.0 @ 40.0,2001.9 | rgb(255, 255, 255) | rgb(229, 231, 235) | 8px | 11px / 700 | 0px 12px | none |
| 2 | 91.0×32.0 @ 139.0,2001.9 | rgb(36, 90, 141) | rgb(36, 90, 141) | 8px | 11px / 700 | 0px 12px | none |
| 3 | 70.0×32.0 @ 238.0,2001.9 | rgba(0, 0, 0, 0) | rgb(229, 231, 235) | 8px | 11px / 700 | 0px 12px | none |
| 4 | 70.0×32.0 @ 40.0,2041.9 | rgb(255, 255, 255) | rgba(180, 35, 24, 0.2) | 8px | 11px / 700 | 0px 12px | none |
| 5 | 70.0×32.0 @ 118.0,2041.9 | rgb(255, 255, 255) | rgb(229, 231, 235) | 8px | 11px / 700 | 0px 12px | none |
### placeholder `.placeholder-cell`
| # | rect | background | border | radius | font | padding | shadow |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.0×0.0 @ 0.0,0.0 | rgb(247, 250, 252) | rgb(216, 228, 239) | 6px | 11px / 400 | 0px 9px | none |
| 2 | 0.0×0.0 @ 0.0,0.0 | rgba(0, 0, 0, 0) | rgb(203, 213, 225) | 6px | 11px / 400 | 0px 9px | none |
| 3 | 128.5×28.0 @ 55.0,2344.8 | rgba(0, 0, 0, 0) | rgb(203, 213, 225) | 6px | 11px / 400 | 0px 9px | none |
| 4 | 128.5×28.0 @ 191.5,2344.8 | rgba(0, 0, 0, 0) | rgb(203, 213, 225) | 6px | 11px / 400 | 0px 9px | none |
| 5 | 0.0×0.0 @ 0.0,0.0 | rgba(0, 0, 0, 0) | rgb(203, 213, 225) | 6px | 11px / 400 | 0px 9px | none |
| 6 | 0.0×0.0 @ 0.0,0.0 | rgba(0, 0, 0, 0) | rgb(203, 213, 225) | 6px | 11px / 400 | 0px 9px | none |
| 7 | 0.0×0.0 @ 0.0,0.0 | rgb(247, 250, 252) | rgb(216, 228, 239) | 6px | 11px / 400 | 0px 9px | none |
| 8 | 62.9×28.0 @ 235.1,2845.2 | rgb(247, 250, 252) | rgb(216, 228, 239) | 6px | 11px / 400 | 0px 9px | none |
| 9 | 106.5×28.0 @ 77.0,2941.2 | rgba(0, 0, 0, 0) | rgb(203, 213, 225) | 6px | 11px / 400 | 0px 9px | none |
| 10 | 106.5×28.0 @ 191.5,2941.2 | rgba(0, 0, 0, 0) | rgb(203, 213, 225) | 6px | 11px / 400 | 0px 9px | none |

#### 实现

### search `.ui-search-control`
| # | rect | background | border | radius | font | padding | shadow |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | 220.0×34.0 @ 40.0,349.6 | rgb(246, 247, 249) | rgb(229, 231, 235) | 7px | 12px / 400 | 0px 10px | none |
| 2 | 220.0×34.0 @ 40.0,415.6 | rgb(255, 255, 255) | rgb(36, 90, 141) | 7px | 12px / 400 | 0px 10px | rgba(36, 90, 141, 0.09) 0px 0px 0px 3px |
| 3 | 220.0×34.0 @ 40.0,481.6 | rgb(246, 247, 249) | rgb(229, 231, 235) | 7px | 12px / 400 | 0px 10px | none |
| 4 | 220.0×34.0 @ 40.0,547.6 | rgb(246, 247, 249) | rgb(229, 231, 235) | 7px | 12px / 400 | 0px 10px | none |
### select `.ui-select-control`
| # | rect | background | border | radius | font | padding | shadow |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | 150.0×34.0 @ 40.0,724.0 | rgba(0, 0, 0, 0) | rgb(17, 24, 39) | 0px | 12px / 400 | 0px | none |
| 2 | 150.0×34.0 @ 40.0,790.0 | rgba(0, 0, 0, 0) | rgb(17, 24, 39) | 0px | 12px / 400 | 0px | none |
| 3 | 150.0×34.0 @ 40.0,856.0 | rgba(0, 0, 0, 0) | rgb(17, 24, 39) | 0px | 12px / 400 | 0px | none |
### input `.ui-input`
| # | rect | background | border | radius | font | padding | shadow |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | 295.0×34.0 @ 40.0,1034.4 | rgb(246, 247, 249) | rgb(229, 231, 235) | 7px | 12px / 400 | 7px 10px | none |
| 2 | 295.0×34.0 @ 40.0,1127.4 | rgb(246, 247, 249) | rgb(229, 231, 235) | 7px | 12px / 400 | 7px 10px | none |
| 3 | 295.0×34.0 @ 40.0,1220.4 | rgb(255, 255, 255) | rgb(36, 90, 141) | 7px | 12px / 400 | 7px 10px | rgba(36, 90, 141, 0.09) 0px 0px 0px 3px |
| 4 | 295.0×34.0 @ 40.0,1290.4 | rgb(246, 247, 249) | rgb(229, 231, 235) | 7px | 12px / 400 | 7px 10px | none |
### textarea `.ui-textarea`
| # | rect | background | border | radius | font | padding | shadow |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | 295.0×84.0 @ 40.0,1468.7 | rgb(246, 247, 249) | rgb(229, 231, 235) | 7px | 12px / 400 | 9px 10px | none |
| 2 | 295.0×84.0 @ 40.0,1611.7 | rgb(255, 255, 255) | rgb(36, 90, 141) | 7px | 12px / 400 | 9px 10px | rgba(36, 90, 141, 0.09) 0px 0px 0px 3px |
### button `.ui-button`
| # | rect | background | border | radius | font | padding | shadow |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.0×0.0 @ 0.0,0.0 | rgba(36, 90, 141, 0.5) | rgb(255, 255, 255) rgb(255, 255, 255) rgb(255, 255, 255) rgb(36, 90, 141) | 6px | 11px / 700 | 0px 12px | none |
| 2 | 0.0×0.0 @ 0.0,0.0 | rgba(0, 0, 0, 0) | rgba(255, 255, 255, 0.45) rgba(255, 255, 255, 0.45) rgba(255, 255, 255, 0.45) rgba(0, 0, 0, 0) | 6px | 11px / 700 | 0px 12px | none |
| 3 | 0.0×0.0 @ 0.0,0.0 | rgba(0, 0, 0, 0) | rgba(255, 255, 255, 0.45) rgba(255, 255, 255, 0.45) rgba(255, 255, 255, 0.45) rgba(0, 0, 0, 0) | 6px | 11px / 700 | 0px 12px | none |
| 4 | 70.0×32.0 @ 40.0,1818.1 | rgb(255, 255, 255) | rgb(229, 231, 235) | 8px | 11px / 700 | 0px 12px | none |
| 5 | 70.0×32.0 @ 118.0,1818.1 | rgb(255, 255, 255) | rgb(229, 231, 235) | 8px | 11px / 700 | 0px 12px | none |
| 6 | 70.0×32.0 @ 196.0,1818.1 | rgb(255, 255, 255) | rgb(229, 231, 235) | 8px | 11px / 700 | 0px 12px | none |
| 7 | 70.0×32.0 @ 40.0,1858.1 | rgb(255, 255, 255) | rgb(229, 231, 235) | 8px | 11px / 700 | 0px 12px | none |
| 8 | 70.0×32.0 @ 118.0,1858.1 | rgb(255, 255, 255) | rgb(229, 231, 235) | 8px | 11px / 700 | 0px 12px | none |
### placeholder `.placeholder-cell`
| # | rect | background | border | radius | font | padding | shadow |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | 123.5×28.0 @ 50.0,2095.3 | rgb(247, 250, 252) | rgb(216, 228, 239) | 6px | 11px / 400 | 0px 9px | none |
| 2 | 123.5×28.0 @ 201.5,2095.3 | rgba(0, 0, 0, 0) | rgb(203, 213, 225) | 6px | 11px / 400 | 0px 9px | none |
| 3 | 123.5×28.0 @ 50.0,2175.3 | rgba(0, 0, 0, 0) | rgb(203, 213, 225) | 6px | 11px / 400 | 0px 9px | none |
| 4 | 123.5×28.0 @ 201.5,2175.3 | rgba(0, 0, 0, 0) | rgb(203, 213, 225) | 6px | 11px / 400 | 0px 9px | none |
| 5 | 123.5×28.0 @ 50.0,2255.3 | rgba(0, 0, 0, 0) | rgb(203, 213, 225) | 6px | 11px / 400 | 0px 9px | none |
| 6 | 123.5×28.0 @ 201.5,2255.3 | rgba(0, 0, 0, 0) | rgb(203, 213, 225) | 6px | 11px / 400 | 0px 9px | none |

## 证据判定

- 固定尺寸截图：通过
- 基线/实现/差异三件套：通过
- 严格 1:1 视觉签核：需结合差异热图与 DOM 样式指标人工确认；脚本不会擅自把非零像素差异判定为通过。

## 运行命令

```powershell
node apps/web/scripts/common-controls-visual-diff.mjs --baseline <design.html> --target-url <implementation-url> --out-dir F:\ChenHai\Project\XianYuAgent-common-controls\docs\evidence\common-controls
```
