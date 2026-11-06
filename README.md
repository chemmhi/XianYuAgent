# FishAgent

**以 Agent 为核心的闲鱼运营平台，覆盖智能客服、商品管理、卡密交付和多用户协作。**

FishAgent 将对话、商品、订单和运营工具接入同一套工作流。自动回复 Agent 会根据问题主动获取买家的对话上下文、商品详情与订单事实；运营者也可以在 Workspace 中用自然语言管理商品、卡密、订单和自动化配置。

## 核心优势与项目区别

本项目的重点是让 Agent 获取真实业务上下文、调用工具并完成任务，将客服与店铺运营连成一条链路。选型时，可以从以下方面比较：

| 能力 | FishAgent 的做法 | 实际价值 |
| --- | --- | --- |
| Agent 自动回复 | 按需调用工具，读取相关对话、商品详情、商品知识库和买家订单，再生成回复 | 能处理连续追问和商品相关问题，减少逐条维护关键词与固定话术的工作 |
| 两套模型 API Key | 支持主、备两套独立的 API Key、接口地址与模型配置，提供自动切换、故障熔断和恢复探测 | 应对模型服务故障、超时、限流和密钥不可用，降低单一模型服务中断的影响 |
| 自动登录与授权恢复 | 支持账密登录、加密保存账密、持久化设备状态，授权过期后自动尝试重新登录 | 减少反复粘贴 Cookie 和手动恢复账号的操作 |
| 滑块与官方验证 | 支持可配置的自动滑块验证；需要扫码或人脸时，通过官方验证流程继续授权 | 将验证和登录恢复纳入账号管理流程，保留必要的人工接管入口 |
| Workspace 运营 Agent | 用自然语言创建或导入卡密、编辑和发布商品、管理订单、修改自动回复与商品自动化规则 | 把“查询情况—准备操作—确认执行—查看结果”放在同一个工作区 |
| 自动发货 | 付款后按商品规则交付卡密或其他内容，支持库存预留、去重和交付记录 | 将订单、商品绑定和交付库存串联起来，减少漏发与重复发货 |
| 邀请码与多用户 | 管理员通过邀请码开放使用，可管理有效期、启停和续期，业务数据按用户及账号权限隔离 | 一套平台可供多个受邀用户使用，各自管理授权账号 |
| 多层上下文 | 区分平台用户、闲鱼账号、买家和具体任务的上下文 | 多用户、多账号运行时，Agent 能围绕当前身份和业务范围处理任务 |

### 自动回复：先取事实，再回答

自动回复由具备工具调用能力的 Agent 执行。它会根据当前问题选择读取哪些信息：

- **对话上下文**：当前消息、待回答消息，以及同一账号下该买家的相关会话。
- **商品上下文**：商品详情、价格、商品知识库和店铺商品搜索结果。
- **订单上下文**：当前买家的订单及交付相关事实。
- **账号配置**：当前闲鱼账号的回复风格、启停状态和运行参数。

信息不足时，Agent 可以继续查询相关工具；确实无法处理时转交人工。系统支持人工介入后停止自动回复、分段发送、发送前检查和结果跟踪，执行过程可在 Agent 动态中查看。上下文按需获取，不会把全部商品和全部聊天记录一次性塞进每个请求。

### 主备模型：两套配置应对模型服务风险

每个账号可以配置主模型与备用模型，分别设置 API Key、Base URL 和模型。系统支持自动路由、手动优先主模型、手动优先备用模型，并根据故障状态进行切换、冷却和恢复探测。

这里的主备机制用于模型 API 的可用性保障；闲鱼账号的登录与平台安全验证由独立的授权恢复流程处理。详见 [模型主备切换](docs/model-provider-failover-v2.md)。

### Workspace：通过 Agent 管理业务

Workspace 可以读取经营概览、账号状态、商品、卡券、订单和 Agent 运行记录，并生成操作计划。例如：

- “查看当前账号有哪些商品，找出需要完善知识库的商品。”
- “新建一批卡密，导入后绑定到指定商品。”
- “修改这个商品的描述，并准备发布。”
- “为这个商品开启付款后自动发货。”
- “查看发货失败的订单，准备重试。”
- “调整当前账号的自动回复配置。”

涉及新增卡密、修改商品、发布、发货或配置变更的操作，会按权限和操作策略生成确认计划，由用户确认后执行，并保留任务步骤、执行结果和审计记录。商品发布需要先具备商品资料与图片；外部结果未知时会先核对状态，避免盲目重复操作。管理员还可通过 Skills 扩展工具能力，受邀用户的能力受角色与授权范围约束。

### 用户级、账号级与买家级上下文

| 层级 | 上下文范围 |
| --- | --- |
| 平台用户级 | 当前登录用户、角色、可访问账号、工作区会话和个人 Skill 授权范围 |
| 闲鱼账号级 | 该账号的商品、卡券、订单、模型配置、自动回复配置和连接状态 |
| 买家级 | 同一闲鱼账号下，该买家的相关对话、当前问题和订单信息 |
| 任务级 | Workspace 当前会话、执行计划、工具结果和待确认操作 |

账号级自动回复配置与 Workspace 的运营任务职责分开，切换账号不会扩大用户原有的数据访问权限。

### 自动登录、滑块与授权恢复

账号管理支持 **扫码登录、账号密码登录、手动输入 Cookie** 三种入口。

账密登录通过服务端 HTTP 提交，后台持久化官方 SDK 环境负责生成当次设备参数，不打开可见的登录窗口。登录成功后，账密加密保存；后续检测到授权过期，会使用保存的账密尝试恢复。普通网络断连先检查现有登录态并重连，避免不必要地重复登录。

系统已有 QR/IM 验证链路支持配置自动滑块验证及有限重试；**当前密码登录出现滑块、扫码或人脸验证时，通过项目的独立验证弹窗由用户按官方提示完成**，随后继续同一登录会话。是否需要验证由平台决定，不保证所有挑战都能自动通过。人工停用、删除或撤销授权的账号不会被自动登录重新启用。

运行要求：稳定的 `CREDENTIAL_ENCRYPTION_KEY`、真实闲鱼模式、正式版 Google Chrome，以及可持久化的浏览器数据目录。使用密码登录需运行到 `076` 数据库迁移。详见 [密码登录与授权恢复](docs/operations/password-login-investigation-20261105.md) 和 [滑块验证说明](docs/17-xianyu-slider-solver.md)。

### 自动发货与邀请使用

商品可以绑定交付内容，支持固定文本、批量卡密、API 接口和图片等卡券类型。启用对应商品规则后，系统根据付款和订单状态执行交付，记录库存预留、发送及结果；失败或结果未知时进入后续核对和处理流程。

平台管理员可以生成邀请码，邀请其他用户注册使用，并管理邀请码及其关联使用权限的有效期、启停和续期。受邀用户管理自己获得授权的闲鱼账号，不会自动继承邀请人的账号、模型密钥或业务数据。

## 功能入口

| 页面 | 主要用途 |
| --- | --- |
| 仪表盘 | 经营概览、订单与自动化处理情况 |
| Workspace | 自然语言运营、业务查询、操作计划与执行跟踪 |
| 账号管理 | 绑定账号、登录与重新授权、连接状态管理 |
| 在线聊天 | 查看会话和消息、人工接管 |
| 商品管理 | 商品同步、编辑、发布、知识库和自动化规则 |
| 卡券管理 | 卡密批次、交付内容、库存及商品绑定 |
| 订单管理 | 订单同步、交付结果及异常处理 |
| Agent 动态 | 查看自动回复阶段、工具调用和执行结果 |
| 设置 | 自动回复、主备模型配置；管理员额外管理邀请码 |

## 本地运行

### 环境要求

- Node.js `>=24.12.0 <25`、npm `>=11.6.0 <12`。
- Docker Engine / Docker Desktop 与 Docker Compose，用于 PostgreSQL、Redis 和 MinIO。
- 正式版 Google Chrome，用于登录设备 SDK、浏览器验证和真实浏览器测试。

项目采用根目录 npm workspaces 统一管理前后端，使用根目录的锁文件。

### 安装与启动

首次配置时复制模板；已有 `.env` 请保留并按需补充字段：

```powershell
Copy-Item .env.example .env
npm run deps:ci
```

在 `.env` 中设置独立、长期保存的 `CREDENTIAL_ENCRYPTION_KEY`，替换示例占位值。已有加密数据时不要直接更换该密钥。模型配置可以通过设置页面保存主、备两套配置。

启动前确认 Docker 已运行：

```powershell
npm run dev
```

该命令会准备 PostgreSQL、Redis、MinIO，执行迁移，并启动 API、Worker 与 Web。默认从 API `8080`、Web `5173` 开始寻找可用端口，实际地址以终端输出为准；前端代理和 WebSocket 来源会同步配置。开发脚本默认使用真实闲鱼模式及 `AUTO_REPLY_SEND_MODE=live`；模拟发送需要调整相应启动配置为 `simulate`。

根命令会为本次 API/Worker 启动共享随机 IM 通信密钥，同时保留已有凭证加密密钥。独立启动 API 与 Worker 时，需设置相同的 `XIANYU_IM_OWNER_SECRET`（至少 32 字符）；未设置时沿用凭证加密密钥。

停止开发进程或重新安装依赖：

```powershell
npm run dev:stop
npm run deps:ci
```

`deps:ci` 会先停止项目管理的开发进程，再安装依赖，避免 Windows 下运行中的原生依赖文件被锁定。

### 检查与测试

```powershell
npm run typecheck
npm test
npm run build
npm run test:e2e:chrome
npm run verify
```

前端浏览器 E2E 使用本机 Chrome 和 Chrome DevTools Protocol；登录与验证运行时使用 Patchright 驱动系统 Chrome。隔离测试夹具通过不等于真实闲鱼账号已登录，真实授权与发货需要在对应环境核验。

密码登录专项验证：

```powershell
npm --workspace apps/api run test:password-login
npm --workspace apps/api run test:password-login:postgres
npm --workspace apps/api run test:password-login:e2e
```

后两项要求先将 `PASSWORD_LOGIN_TEST_DATABASE_URL` 指向本机专用数据库 `xianyu_password_login_test`，数据库用户需有 `CREATEDB` 权限；测试会创建和清理随机子库，不要连接生产数据库。

### Docker 与项目目录

```powershell
npm run compose:config
npm run compose:up:d
npm run compose:logs
npm run compose:ps
npm run compose:down
```

开发 Compose 管理 API、Worker、PostgreSQL、Redis 和 MinIO；Web 使用根目录开发命令启动。MinIO 映射到 `19000/19001`，可用 `OBJECT_STORAGE_IMAGE` 覆盖开发镜像。

- `apps/web/`：正式 React + Vite 前端。
- `apps/api/`：Node.js / TypeScript API、数据库迁移与 Worker。
- `SellerAgent/`：只读原型及视觉参考。
- `xianyu-admin-design-style/`：设计规范参考。
- `docs/`：架构、功能、验收及运维文档。

## 生产部署

生产代码从 GitHub `origin/main` 获取。变更先在功能分支完成检查，再在本地合入 `main`，最后推送；不要从功能分支直接推送到远程 `main`。

```powershell
# 在已确认干净的本地 main 工作区执行
# codex/<功能分支> 替换为已完成验证的实际分支名

git switch main
git merge --no-ff codex/<功能分支>
git push origin main
```

当前仓库的 `main` 推送会触发 [生产部署工作流](.github/workflows/deploy-production.yml)，服务器拉取同一 SHA 后执行 [统一部署脚本](scripts/deploy-production.sh)：

```text
本地合入 main 并推送 GitHub
  → GitHub Actions 校验部署配置与 SSH 主机指纹
  → 服务器 fetch / pull --ff-only，并核对提交 SHA
  → 构建前端与后端镜像，执行数据库迁移，重建 API / Worker
  → 后端健康检查，备份并发布前端，检查公网入口
```

自建部署需配置自己的服务器、域名、`.env` 和 GitHub Actions secrets：`DEPLOY_HOST`、`DEPLOY_USER`、`DEPLOY_SSH_KEY`、`DEPLOY_KNOWN_HOSTS`，以及可选的 `DEPLOY_PORT`、`DEPLOY_PATH`。当前工作流将服务器 `origin` 限制为 `chemmhi/XianYuAgent`，使用 fork 时还需同步修改工作流中的仓库来源校验。统一脚本有当前部署环境的默认路径与域名，自建时应按实际环境配置。生产使用 `compose.prod.yml`，不要直接套用开发 Compose 的端口与凭据。

发布保留数据卷和浏览器目录，已有数据库需要显式迁移。密码登录在 API owner 上运行，Worker 不重复启动恢复任务。发布后应核对功能开关、加密密钥、迁移和 Chrome 是否实际生效；仅 `/healthz` 返回成功不能证明账号已恢复。完整配置、备份及回滚方法见 [生产部署说明](docs/operations/production-deployment.md)。

## 进一步阅读

- [自动回复 Agent 设计](docs/agent/auto-reply/design.md)
- [模型主备切换](docs/model-provider-failover-v2.md)
- [Workspace 业务能力与权限边界](docs/agent/workspace/WS-VS-05-platform-takeover.md)
- [邀请码注册与用户隔离](docs/invite-registration/PLAN.md)
- [密码登录与授权恢复](docs/operations/password-login-investigation-20261105.md)
- [自动化交付运维](docs/automation/delivery-cutover-runbook.md)
- [记录保留与清理](docs/operations/record-retention.md)
- [项目经验与回归约束](docs/PROJECT_LESSONS.md)
- [项目协作与 Git 规则](AGENTS.md)
