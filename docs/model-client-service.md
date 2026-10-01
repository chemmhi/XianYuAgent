# ModelClient 服务使用规范

- 生效日期：2026-10-01
- 适用范围：所有需要调用大模型的 API、Worker、Workspace、CLI 和后台任务
- 目标：统一 API Key、Provider 选择、超时、失败切换和模型调用协议

## 1. 强制边界

后续新增或修改的大模型功能必须依赖 `apps/api/src/model-client.ts` 导出的 `ModelClient` 接口或 `ModelClientService`，不得在业务模块中直接创建 `OpenAICompatibleModelClient`。

允许直接创建底层 Provider 适配器的地方只有：

1. API 组合根 `apps/api/src/app.ts`；
2. `OpenAISettingsService` 等凭证 / Provider 基础设施；
3. 针对底层 HTTP 协议的单元测试和 smoke 测试。

商品、知识库、自动回复、Workspace、Worker 和 CLI 业务代码只接收 `ModelClient`，不读取 API Key、不拼接 Provider URL、不判断主备角色。

## 2. 服务职责

`ModelClientService` 负责：

- 按主 Provider → 备用 Provider 的顺序执行请求；
- 主 Provider 抛出 HTTP、超时、网络或响应解析错误时自动尝试备用 Provider；
- 保留备用 Provider 的最终错误，避免业务层重复实现切换逻辑；
- 根据所有候选 Provider 的能力计算 `supportsWebSearch`；
- 可通过 `onFailover` 记录指标或审计事件；观测回调失败不能阻断备用切换。

当前服务只执行一次主请求和一次备用请求，不做无限重试或 Provider 轮询。

## 3. 正确接入方式

### 3.1 账号级 API / Worker

使用应用组合根提供的账号级 resolver：

```ts
const client = await resolveConfiguredModelClient(adminId, accountId);
if (!client) throw new ServiceError(409, 'MODEL_PROVIDER_NOT_CONFIGURED', '模型 Provider 未配置');
const result = await client.complete({ messages });
```

resolver 会读取当前账号的 active `primary` / `backup` CredentialRef，解密凭证，并返回已经包含故障切换的 `ModelClientService`。

### 3.2 Workspace PI Runtime

Workspace 必须通过 `PiRuntimeAdapterOptions.resolveModelClient` 按 Run 的 `adminId + accountId` 动态解析 `ModelClient`。不能在 Runtime 中缓存某个账号的 API Key，也不能只使用进程环境变量中的单一 Provider。

### 3.3 CLI / 独立任务

CLI 使用 `createModelClientServiceFromEnv()`。主配置读取 `API_KEY / BASE_URL / MODEL`，可选备用配置读取 `BACKUP_API_KEY / BACKUP_BASE_URL / BACKUP_MODEL`。CLI 业务逻辑仍然只调用 `ModelClient.complete()`。

### 3.4 新增业务模块

新增模块的构造函数应接收 `ModelClient` 或 `ModelClient` resolver：

```ts
class ExampleAiService {
  constructor(private readonly modelClient: ModelClient) {}

  async run(input: string) {
    return this.modelClient.complete({
      messages: [{ role: 'user', content: input }],
    });
  }
}
```

禁止在该模块中：

- `new OpenAICompatibleModelClient(...)`；
- 直接读取 `API_KEY`、数据库密文或 CredentialValue；
- 自己实现 `try primary / catch backup`；
- 把主备切换错误吞掉后返回假成功；
- 把 API Key、Authorization Header 或完整 Provider URL 写入日志、事件和用户响应。

## 4. 测试要求

每个新增大模型入口至少覆盖：

1. 主 Provider 成功，备用 Provider 不被调用；
2. 主 Provider 失败，备用 Provider 成功；
3. 主备都失败，Run / API 返回明确失败；
4. Responses API 请求体和响应解析；
5. 超时、网络错误或非法响应的失败路径；
6. 账号范围隔离，不能使用其他账号的 Provider。

底层 Provider 协议 smoke 可以直接测试 `OpenAICompatibleModelClient`，但不能代替业务模块通过 `ModelClientService` 的主备回归。

## 5. 维护清单

- 新增 AI 入口时，先在 `apps/api/src/model-client.ts` 和本规范中确认依赖边界；
- 在 `app.ts` 组合根完成 Provider 装配和 resolver 注入；
- 在功能模块中只保存 `ModelClient` 引用；
- 为主成功、主失败切备、备失败补充回归测试；
- 如果修改 wire API，默认优先使用 Responses，并同步更新对应 mock server；
- 合并前运行 `npm --workspace apps/api run test:model-client`、受影响功能测试、`npm --workspace apps/api run build` 和 `git diff --check`。
