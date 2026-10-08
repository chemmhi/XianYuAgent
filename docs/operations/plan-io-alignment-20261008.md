# Plan I/O 对齐改造方案（v6，独立审核稿）

## 1. 真实目标与验收行为

用户真实行为：在本地开发环境打开 Workspace，输入“用 03 PPT Master 的网盘公开分享链接创建一个卡券，关联‘AI 技术咨询，需求定制开发服务’这个商品，然后启用自动发货”；Agent 必须先获得网盘公开分享 URL，再按商品标题定位商品，创建 API 型卡券并把 URL 写入 `metadata.apiConfig.url`，关联卡券与商品，最后启用商品付费自动发货；每个写操作出现 Confirmation 时由浏览器点击确认，最终页面只出现一次成功答复，数据库/商品页可复读最终状态。

验收证据必须覆盖：Plan 事件、工具调用顺序、三次 Confirmation 续跑、分享 URL、productId、coupon batch sequence_id、active binding、`products.automation_configs.config_json->paidAutoDelivery`。

## 2. 现状证据

- `apps/api/src/workspace-context.ts` 的 Planner 只把工具名交给模型；`deriveFallbackWorkspacePlan()` 通过业务关键词和固定工具顺序拼装计划。
- `apps/api/src/workspace-plan-contract.ts` 维护 `SUPPORTED_TOOLS`/`SUPPORTED_ACTIONS`，并按工具名与 goal 正则推断 action。
- `apps/api/src/pi-runtime.ts` 只有带 `policyKey`/`goalPredicateId` 的计划才严格限流；普通 Plan 可能被模型换工具或提前收口。
- 工具 JSON Schema 已存在：`workspace-commands.ts:70-116`、`pi-skills.ts:463-545`；但没有统一输入事实、输出事实、确认和副作用契约。
- 真实写入事实来源已确认：卡券创建确认后写入 `workspace.coupon.created.payload.batchId`；通用写回写入 `workspace.command.completed.payload.result`；卡券绑定结果位于该 result 的 `binding`/`batch` 结构；自动化配置持久化表为 `products.automation_configs`。
- 现有 Skill E2E `apps/web/scripts/e2e-workspace-skill-share-postgres.mjs` 只覆盖 Skill 四步链路，不覆盖商品/卡券/绑定/自动发货/Confirmation。

## 3. 设计原则与边界

### 3.1 原则

1. Plan 只由运行时传入的工具 JSON Schema、版本化 Plan 元数据和真实结果事实驱动。
2. Planner/Plan Runtime 禁止硬编码工具名、业务关键词、动作枚举、商品/文件名、固定路由或固定多步顺序。
3. 工具 adapter 可以按工具名分派到业务实现；该分派不参与 Plan 生成、步骤排序或完成判断。
4. 缺少工具契约、输入不满足 Schema、输出事实缺失、计划恢复版本不匹配时 fail-closed，错误必须可从 Run Event/DOM/DB 复核。

### 3.2 非目标

- 不重写 `WorkspaceCommandOrchestrator`、`PiSkillManager` 的业务 adapter；只补齐它们返回的 function tool Plan 元数据。
- 不删除 Confirmation/Outbox/既有领域 operation；Plan 只约束调用时机、事实依赖与完成条件。

## 4. 统一工具 Plan 契约（精确结构）

新增可序列化 `WorkspaceToolPlanMetadata`，由 `ModelToolDefinition.function.plan` 携带，发送给 Provider 前剥离：

```ts
type WorkspacePlanValueType = 'string' | 'number' | 'boolean' | 'array' | 'object';
type WorkspacePlanPath = 'args' | `args.${string}` | 'result.data' | `result.data.${string}` | 'result.data.parsed' | `result.data.parsed.${string}` | 'event.payload' | `event.payload.${string}`;

interface WorkspacePlanJsonSchema {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  properties?: Record<string, WorkspacePlanJsonSchema>;
  items?: WorkspacePlanJsonSchema;
  required?: string[];
  enum?: Array<string | number | boolean | null>;
  additionalProperties?: boolean | WorkspacePlanJsonSchema;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
}

interface WorkspacePlanOutputFact {
  key: string;
  paths: WorkspacePlanPath[];
  valueType: WorkspacePlanValueType;
  requiredOnSuccess: boolean;
  merge: 'overwrite' | 'preserve';
  source?: 'tool_result' | 'confirmation_event' | 'either';
  condition?: { path: WorkspacePlanPath; arrayLengthEquals?: number; equals?: string | number | boolean | null };
  onConditionFalse?: 'skip' | 'fail';
}

interface WorkspacePlanInputBinding {
  fact: string;
  paths: Array<`args.${string}`>;
  valueType: WorkspacePlanValueType;
  required: boolean;
  merge: 'overwrite' | 'preserve';
}

interface WorkspaceToolPlanVariant {
  sideEffect: 'read' | 'prepare_write' | 'external_write';
  confirmationPolicy: 'none' | 'required';
  replay: 'reusable' | 'non_reusable';
  inputFacts: string[];
  inputBindings: WorkspacePlanInputBinding[];
  outputFacts: WorkspacePlanOutputFact[];
  argumentSchema: WorkspacePlanJsonSchema;
}
interface WorkspaceToolPlanMetadata {
  contractVersion: number;
  discriminator?: { field: string; variants: Record<string, WorkspaceToolPlanVariant> };
  default?: WorkspaceToolPlanVariant;
}

interface WorkspaceExecutionPlanStepDocument {
  id: string;
  tool: string;
  variant: string;
  contractVersion: number;
  goal: string;
  status: 'pending' | 'running' | 'succeeded' | 'waiting_confirmation' | 'blocked';
  attempts: number;
  inputFacts: string[];
  inputBindings: WorkspacePlanInputBinding[];
  outputFacts: WorkspacePlanOutputFact[];
  confirmationPolicy: 'none' | 'required';
  evidence?: string;
}

interface WorkspaceExecutionPlanDocument {
  version: 1;
  revision: number;
  goal: string;
  status: 'active' | 'waiting_confirmation' | 'blocked' | 'completed';
  currentStepId?: string;
  steps: WorkspaceExecutionPlanStepDocument[];
  facts: Record<string, unknown>;
  factSources: Record<string, { toolName: string; variant: string; eventType: string; sequence: number }>;
  replanCount: number;
}
```

Path grammar is closed: `args.*` reads proposed arguments, `result.data.*` and `result.data.parsed.*` read tool payloads, and `event.payload.*` reads normalized domain-event payloads. Paths use dot segments with optional numeric `[index]` segments only; no code, wildcard, JSONPath operator, or arbitrary property evaluation is allowed.

`condition` is the only conditional extraction primitive. When `condition` is false, `onConditionFalse='skip'` suppresses that fact without treating a successful tool result as a contract failure; the plan must then continue to a later clarification/refinement step. `requiredOnSuccess=true` is evaluated only after the condition (if any) matches.

The parser accepts exactly `^(args|result\.data|result\.data\.parsed|event\.payload)(\.[A-Za-z_][A-Za-z0-9_]*|\[[0-9]+\])*$`; it tokenizes dot properties and numeric indexes, rejects empty segments, negative indexes, wildcards, and prototype keys, and never evaluates source text as code. `source:'confirmation_event'` defers extraction and the `requiredOnSuccess` check until the matching post-confirmation domain event (`workspace.coupon.created` or `workspace.command.completed`) is appended. A `write_plan` tool result therefore advances the step to `waiting_confirmation` without attempting to satisfy deferred output facts; the confirm continuation must extract them from the later event before marking the step succeeded. `source:'tool_result'` is checked immediately; `source:'either'` accepts the first valid value from either phase.

`result` means the normalized `WorkspaceModelToolResult` root persisted in `tool.result`; `event.payload` means the persisted domain-event payload. Within one descriptor, `paths` are tried left-to-right. If exactly one path yields a correctly typed value, that value wins. If multiple paths yield values that differ, extraction fails closed with `PLAN_OUTPUT_FACT_MISSING` and records the conflicting paths; equal duplicates are accepted and the first path remains the provenance source. This precedence/conflict rule is mandatory and covered by contract tests.

- 顶层 function `parameters` 仍是 Provider 可见输入 Schema；`argumentSchema` 是 Runtime 内部对 `operation`/`command` 变体的递归校验 Schema，不含自定义 `requiresFacts` 字段。
- `inputFacts` 表示必须从前序结果事实获得的键；参数中直接携带的值只有在对应 `inputBindings.required=false` 时才能建立临时 fact 并记录 provenance。`required=true` 的绑定必须先存在前序 fact，且参数值必须与事实相等。
- `outputFacts.paths` 统一从 `result.data.*`、`result.data.parsed.*` 或规范化事件对象的 `event.payload.*` 读取；`workspace.command.completed` 的业务结果位于 `event.payload.result.*`，`workspace.coupon.created` 的批次事实位于 `event.payload.batchId`。路径不存在时按 `requiredOnSuccess` 处理。
- 计划步骤持久化 `contractVersion` 与变体 discriminator 值；恢复时必须重新绑定同 `tool + contractVersion + variant`。
- `factSources[key] = { toolName, variant, eventType, sequence }`；`merge=preserve` 不覆盖已有值，`overwrite` 允许更新；类型错误等同 `PLAN_OUTPUT_FACT_MISSING`。

## 5. 首批工具契约实际种子

所有 function tools 都必须提供 `contractVersion=1`，缺失即 `PLAN_CONTRACT_MISSING`。非 discriminator 工具必须提供 `default`；discriminator 工具可以只提供 `variants`，但未注册的 discriminator 值必须返回 `PLAN_CONTRACT_MISSING`。下列扁平键 `tool/variant` 在实现中统一包装为 `{ contractVersion: 1, default: <default descriptor>, discriminator: { field, variants: { <variant>: <descriptor> } } }`；实现不得自行猜测另一套注册表形状。以下是编码时必须逐字落地的关键变体 descriptor（省略的非关键工具也必须使用同一字段完整性）：

```json
{
  "workspace_product_search/default": {
    "sideEffect": "read", "confirmationPolicy": "none", "replay": "reusable", "inputFacts": [], "inputBindings": [],
    "outputFacts": [
      {"key":"productId","paths":["result.data.productId"],"valueType":"string","requiredOnSuccess":true,"merge":"overwrite","source":"tool_result","condition":{"path":"result.data.items","arrayLengthEquals":1},"onConditionFalse":"skip"},
      {"key":"productTitle","paths":["result.data.items[0].title"],"valueType":"string","requiredOnSuccess":true,"merge":"overwrite","source":"tool_result","condition":{"path":"result.data.items","arrayLengthEquals":1},"onConditionFalse":"skip"},
      {"key":"candidateItems","paths":["result.data.items"],"valueType":"array","requiredOnSuccess":false,"merge":"overwrite","source":"tool_result"}
    ],
    "argumentSchema":{"type":"object","required":["query"],"properties":{"query":{"type":"string"}},"additionalProperties":false}
  },
  "workspace_prepare_write/coupon_create": {
    "sideEffect":"prepare_write", "confirmationPolicy":"required", "replay":"non_reusable", "inputFacts":["shareUrl"],
    "inputBindings":[{"fact":"shareUrl","paths":["args.parameters.apiConfig.url"],"valueType":"string","required":true,"merge":"preserve"}],
    "outputFacts":[{"key":"couponBatchId","paths":["event.payload.batchId","result.data.batchId"],"valueType":"string","requiredOnSuccess":true,"merge":"overwrite","source":"confirmation_event"}],
    "argumentSchema":{"type":"object","required":["operation","parameters"],"properties":{"operation":{"type":"string","enum":["coupon_create"]},"parameters":{"type":"object","required":["label","purpose","apiConfig"],"properties":{"label":{"type":"string"},"purpose":{"type":"string","enum":["api"]},"apiConfig":{"type":"object","required":["url","method"],"properties":{"url":{"type":"string"},"method":{"type":"string","enum":["GET"]}},"additionalProperties":false}},"additionalProperties":true}},"additionalProperties":false}
  },
  "workspace_prepare_write/coupon_bind": {
    "sideEffect":"prepare_write", "confirmationPolicy":"required", "replay":"non_reusable", "inputFacts":["productId","couponBatchId"],
    "inputBindings":[{"fact":"productId","paths":["args.parameters.productId"],"valueType":"string","required":true,"merge":"preserve"},{"fact":"couponBatchId","paths":["args.parameters.batchId"],"valueType":"string","required":true,"merge":"preserve"}],
    "outputFacts":[{"key":"boundCouponBatchId","paths":["event.payload.result.binding.batchId","event.payload.result.batch.id","result.data.binding.batchId"],"valueType":"string","requiredOnSuccess":true,"merge":"overwrite","source":"confirmation_event"}],
    "argumentSchema":{"type":"object","required":["operation","parameters"],"properties":{"operation":{"type":"string","enum":["coupon_bind"]},"parameters":{"type":"object","required":["productId","batchId"],"properties":{"productId":{"type":"string"},"batchId":{"type":"string"}},"additionalProperties":true}},"additionalProperties":false}
  },
  "workspace_prepare_write/product_automation_update": {
    "sideEffect":"prepare_write", "confirmationPolicy":"required", "replay":"non_reusable", "inputFacts":["productId","couponBatchId"],
    "inputBindings":[{"fact":"productId","paths":["args.parameters.productId"],"valueType":"string","required":true,"merge":"preserve"},{"fact":"couponBatchId","paths":["args.parameters.config.paidAutoDelivery.couponBatchIds[0]"],"valueType":"string","required":true,"merge":"preserve"}],
    "outputFacts":[
      {"key":"configVersion","paths":["event.payload.result.configVersion","result.data.configVersion"],"valueType":"number","requiredOnSuccess":true,"merge":"overwrite","source":"confirmation_event"},
      {"key":"paidAutoDeliveryEnabled","paths":["event.payload.result.config.paidAutoDelivery.enabled","result.data.config.paidAutoDelivery.enabled"],"valueType":"boolean","requiredOnSuccess":true,"merge":"overwrite","source":"confirmation_event"},
      {"key":"boundCouponBatchIds","paths":["event.payload.result.config.paidAutoDelivery.couponBatchIds","result.data.config.paidAutoDelivery.couponBatchIds"],"valueType":"array","requiredOnSuccess":true,"merge":"overwrite","source":"confirmation_event"}
    ],
    "argumentSchema":{"type":"object","required":["operation","parameters"],"properties":{"operation":{"type":"string","enum":["product_automation_update"]},"parameters":{"type":"object","required":["productId","config"],"properties":{"productId":{"type":"string"},"config":{"type":"object","required":["paidAutoDelivery"],"properties":{"paidAutoDelivery":{"type":"object","required":["enabled","couponBatchIds"],"properties":{"enabled":{"type":"boolean"},"couponBatchIds":{"type":"array","items":{"type":"string"}}},"additionalProperties":true}},"additionalProperties":true}},"additionalProperties":false}},"additionalProperties":false}
  },
  "pi_skill_exec/search": {"sideEffect":"read","confirmationPolicy":"none","replay":"reusable","inputFacts":[],"inputBindings":[],"outputFacts":[{"key":"fid","paths":["result.data.parsed.items[0].fid"],"valueType":"string","requiredOnSuccess":true,"merge":"overwrite","source":"tool_result","condition":{"path":"result.data.parsed.items","arrayLengthEquals":1},"onConditionFalse":"skip"},{"key":"commandStatus","paths":["result.data.status"],"valueType":"string","requiredOnSuccess":false,"merge":"overwrite","source":"tool_result"}],"argumentSchema":{"type":"object","required":["skillId","command"],"properties":{"skillId":{"type":"string"},"command":{"type":"string","enum":["search"]},"args":{"type":"array","items":{"type":"string"}}},"additionalProperties":false}},
  "pi_skill_exec/share": {"sideEffect":"external_write","confirmationPolicy":"none","replay":"non_reusable","inputFacts":["fid"],"inputBindings":[{"fact":"fid","paths":["args.args[0]"],"valueType":"string","required":true,"merge":"preserve"}],"outputFacts":[{"key":"shareUrl","paths":["result.data.parsed.url","result.data.parsed.shareUrl"],"valueType":"string","requiredOnSuccess":true,"merge":"overwrite","source":"tool_result"},{"key":"commandStatus","paths":["result.data.status"],"valueType":"string","requiredOnSuccess":false,"merge":"overwrite","source":"tool_result"}],"argumentSchema":{"type":"object","required":["skillId","command"],"properties":{"skillId":{"type":"string"},"command":{"type":"string","enum":["share"]},"args":{"type":"array","items":{"type":"string"}}},"additionalProperties":false}}
}
```

The remaining variants are fixed, fully specified as follows. All descriptors include `sideEffect`, `confirmationPolicy`, `replay`, `inputFacts`, `inputBindings`, `outputFacts` with explicit `valueType`, `requiredOnSuccess`, `merge`, `source`, and a complete `argumentSchema`:

```json
{
  "workspace_read/default":{"sideEffect":"read","confirmationPolicy":"none","replay":"reusable","inputFacts":[],"inputBindings":[],"outputFacts":[{"key":"readback","paths":["result.data"],"valueType":"object","requiredOnSuccess":false,"merge":"overwrite","source":"tool_result"}],"argumentSchema":{"type":"object","required":["instruction"],"properties":{"instruction":{"type":"string"}},"additionalProperties":false}},
  "pi_skill_list/default":{"sideEffect":"read","confirmationPolicy":"none","replay":"reusable","inputFacts":[],"inputBindings":[],"outputFacts":[{"key":"skillItems","paths":["result.data.items"],"valueType":"array","requiredOnSuccess":false,"merge":"overwrite","source":"tool_result"}],"argumentSchema":{"type":"object","properties":{},"additionalProperties":false}},
  "pi_skill_install/default":{"sideEffect":"external_write","confirmationPolicy":"none","replay":"non_reusable","inputFacts":[],"inputBindings":[],"outputFacts":[{"key":"skillId","paths":["result.data.item.id"],"valueType":"string","requiredOnSuccess":false,"merge":"overwrite","source":"tool_result"},{"key":"authorized","paths":["result.data.item.authorized"],"valueType":"boolean","requiredOnSuccess":false,"merge":"overwrite","source":"tool_result"}],"argumentSchema":{"type":"object","required":["source"],"properties":{"source":{"type":"string"},"expectedSha256":{"type":"string"}},"additionalProperties":false}},
  "pi_skill_authorize/default":{"sideEffect":"external_write","confirmationPolicy":"none","replay":"non_reusable","inputFacts":[],"inputBindings":[],"outputFacts":[{"key":"skillId","paths":["result.data.skillId"],"valueType":"string","requiredOnSuccess":false,"merge":"overwrite","source":"tool_result"},{"key":"resultCode","paths":["result.data.code"],"valueType":"number","requiredOnSuccess":false,"merge":"overwrite","source":"tool_result"}],"argumentSchema":{"type":"object","required":["skillId","token"],"properties":{"skillId":{"type":"string"},"token":{"type":"string"}},"additionalProperties":false}},
  "pi_skill_login/default":{"sideEffect":"external_write","confirmationPolicy":"none","replay":"non_reusable","inputFacts":[],"inputBindings":[],"outputFacts":[{"key":"skillId","paths":["result.data.skillId"],"valueType":"string","requiredOnSuccess":false,"merge":"overwrite","source":"tool_result"},{"key":"loginStatus","paths":["result.data.status"],"valueType":"string","requiredOnSuccess":false,"merge":"overwrite","source":"tool_result"},{"key":"resultCode","paths":["result.data.code"],"valueType":"number","requiredOnSuccess":false,"merge":"overwrite","source":"tool_result"}],"argumentSchema":{"type":"object","required":["skillId"],"properties":{"skillId":{"type":"string"},"token":{"type":"string"},"args":{"type":"array","items":{"type":"string"}}},"additionalProperties":false}},
  "pi_skill_catalog/default":{"sideEffect":"read","confirmationPolicy":"none","replay":"reusable","inputFacts":[],"inputBindings":[],"outputFacts":[{"key":"skillId","paths":["result.data.skillId"],"valueType":"string","requiredOnSuccess":false,"merge":"overwrite","source":"tool_result"},{"key":"documents","paths":["result.data.documents"],"valueType":"array","requiredOnSuccess":false,"merge":"overwrite","source":"tool_result"}],"argumentSchema":{"type":"object","required":["skillId"],"properties":{"skillId":{"type":"string"}},"additionalProperties":false}},
  "pi_skill_read/default":{"sideEffect":"read","confirmationPolicy":"none","replay":"reusable","inputFacts":[],"inputBindings":[],"outputFacts":[{"key":"sourceFile","paths":["result.data.sourceFile"],"valueType":"string","requiredOnSuccess":false,"merge":"overwrite","source":"tool_result"},{"key":"totalChars","paths":["result.data.totalChars"],"valueType":"number","requiredOnSuccess":false,"merge":"overwrite","source":"tool_result"},{"key":"truncated","paths":["result.data.truncated"],"valueType":"boolean","requiredOnSuccess":false,"merge":"overwrite","source":"tool_result"}],"argumentSchema":{"type":"object","required":["skillId"],"properties":{"skillId":{"type":"string"},"filePath":{"type":"string"}},"additionalProperties":false}},
  "pi_skill_search/default":{"sideEffect":"read","confirmationPolicy":"none","replay":"reusable","inputFacts":[],"inputBindings":[],"outputFacts":[{"key":"sourceFile","paths":["result.data.sourceFile"],"valueType":"string","requiredOnSuccess":false,"merge":"overwrite","source":"tool_result"},{"key":"commandEvidence","paths":["result.data.commandEvidence"],"valueType":"array","requiredOnSuccess":false,"merge":"overwrite","source":"tool_result"}],"argumentSchema":{"type":"object","required":["skillId","query"],"properties":{"skillId":{"type":"string"},"query":{"type":"string"},"mode":{"type":"string","enum":["literal","fuzzy","regex"]},"filePath":{"type":"string"},"cursor":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":50}},"additionalProperties":false}},
  "workspace_prepare_write/other":{"sideEffect":"prepare_write","confirmationPolicy":"required","replay":"non_reusable","inputFacts":[],"inputBindings":[],"outputFacts":[{"key":"manifest","paths":["result.data"],"valueType":"object","requiredOnSuccess":false,"merge":"overwrite","source":"tool_result"}],"argumentSchema":{"type":"object","properties":{"operation":{"type":"string"},"parameters":{"type":"object","additionalProperties":true},"instruction":{"type":"string"},"productId":{"type":"string"}},"additionalProperties":false}}
}
```

`workspace_prepare_write/other` intentionally keeps `parameters.additionalProperties=true` because the adapter is forward-compatible; the Runtime still requires the adapter-exported operation schema for any selected concrete operation. `pi_skill_exec` registers only the documented `search` and `share` variants in this release. Any other command must publish a distinct manifest-backed variant with explicit side-effect, confirmation, replay, input, and output metadata before it can be planned; an unregistered command returns `PLAN_CONTRACT_MISSING` and is never executed.

`shareUrl` is produced only by `pi_skill_exec/share` and consumed only through the `coupon_create` input binding; it is not a `coupon_create` output fact. The target card uses `purpose='api'` and `parameters.apiConfig={url: shareUrl, method:'GET'}`; the normalized execution plan persists this under coupon metadata, and the removed `quark_url` field is never written.

目标卡券使用 `purpose='api'`，`parameters.apiConfig = { url: shareUrl, method: 'GET' }`；规范化后由 adapter 写入卡券 metadata；不使用已删除的 `quark_url` 字段。

## 6. Plan 生成、空计划与重规划

### 6.0 Provider Plan JSON Schema

The planner request includes a machine-readable plan schema derived from the injected tool metadata. The provider must return exactly this shape (no prose and no undeclared fields):

{"type":"object","required":["steps"],"properties":{"steps":{"type":"array","minItems":0,"maxItems":8,"items":{"type":"object","additionalProperties":false,"required":["tool","variant","contractVersion","goal"],"properties":{"tool":{"type":"string"},"variant":{"type":"string"},"contractVersion":{"type":"integer","minimum":1},"goal":{"type":"string","minLength":1,"maxLength":120}}}}},"additionalProperties":false}

variant is default for non-discriminated tools and the discriminator value for variant tools; contractVersion must equal the selected metadata contract. Runtime resolves every step against the exact (tool, variant, contractVersion) tuple and persists that tuple on the step. It may fill inputFacts, inputBindings, outputFacts, and confirmation policy from metadata, but it may not infer or substitute a different tuple.

The persisted plan document has a second, explicit schema: `{version:1,revision:number,goal:string,status:'active'|'waiting_confirmation'|'blocked'|'completed',currentStepId?:string,steps:[{id,tool,variant,contractVersion,goal,status,attempts,inputFacts,inputBindings,outputFacts,confirmationPolicy,evidence?}],facts:object,factSources:object,replanCount:number}`. Every step field listed above is persisted; `factSources` records the first successful extraction event and sequence for each fact. A plan cannot be marked completed unless every step is succeeded, currentStepId is absent, and all required facts for the final successful steps have a source event.

### 6.1 首次生成

`createWorkspaceExecutionPlanFromModel()` 输入完整 tool name/description/provider Schema/Plan metadata；system prompt 只描述 JSON 结构和工具合同摘要，不写业务样例。`fallback` 参数被移除/忽略，禁止关键词 fallback。输出：

- `{"steps":[]}` → `PLAN_NOT_REQUIRED`，不创建计划，继续普通模型回答；该路径后续如果出现任何 tool call，Runtime 写 `PLAN_STEP_MISMATCH` 并停止。
- 合法非空 steps → 创建 `WorkspaceExecutionPlan`，每步由 Runtime 根据工具契约回填 variant、contractVersion、inputFacts/outputFacts/confirmation。
- Provider 超时、JSON 无效、引用不存在工具、缺契约或超过 8 步 → `PLAN_UNAVAILABLE` 或 `PLAN_CONTRACT_MISSING`，不调用关键词 fallback，Run 失败并可重试。

### 6.2 重规划

输入原计划、失败工具/变体/错误码/摘要、已完成与剩余步骤、同一合同摘要；保留 succeeded steps，失败 step blocked，最多重规划两次；第一替代步骤不得重复失败工具/变体；任何新步骤仍需契约存在。

## 7. Runtime 状态机与错误落库

1. `strictPlanExecution = Boolean(executionPlan)`；存在 Plan 时每轮最多一个工具调用。
2. 调用前校验当前 step 的 `tool + variant + contractVersion`、inputFacts、顶层 JSON Schema、variant `argumentSchema`；失败写 `tool.result(status=failed)` + `workspace.plan.updated(reason=<PLAN_*>)`，不执行 adapter。
3. 成功结果先按现有事件写入 `tool.result(status=succeeded)`；再提取 outputFacts。若必需事实缺失，追加 `workspace.plan.updated(status=blocked, reason=PLAN_OUTPUT_FACT_MISSING)`，随后 Step/Run failed；不能把该步骤推进到 pending 后续步骤。
4. `prepare_write` 返回 `write_plan` 时 Plan/Step/Run=`waiting_confirmation`；Confirm API 先写 `workspace.confirmation.confirmed`，再写 Plan updated/complete step，调用 `continueAfterConfirmation(resumeAfterConfirmation=true)`。
5. Cancel API 先写 Plan updated=`blocked/confirmation_cancelled`，再沿现有 `workspace.ts` 将 Run/Step 置 `cancelled`；失败重连沿现有 `resumeFromFailure=true`，仅 `reopenBlockedWorkspacePlan()` 后继续。
6. Plan 恢复必须匹配 `tool + contractVersion + variant`；否则 `PLAN_CONTRACT_UNAVAILABLE`，不执行工具。
7. 计划完成须 status=`completed`、无 currentStep、所有 steps succeeded、无 pending/waiting/blocked；未完成时无工具调用只能继续下一轮，禁止最终答复。

允许错误码：`PLAN_NOT_REQUIRED`、`PLAN_UNAVAILABLE`、`PLAN_CONTRACT_MISSING`、`PLAN_CONTRACT_UNAVAILABLE`、`PLAN_ARGUMENT_INVALID`、`PLAN_STEP_MISMATCH`、`PLAN_FACT_MISSING`、`PLAN_OUTPUT_FACT_MISSING`、`PLAN_NOT_COMPLETE`。

## 8. 硬编码边界与审计

**Deny（计划层）**：`SUPPORTED_TOOLS/ACTIONS`；`deriveFallbackWorkspacePlan`/关键词 cue；`inferWorkspaceStepAction`；按 `startsWith('pi_skill_')` 决定 Plan 语义；PI system prompt 写死目标任务流程；固定商品/文件名；Plan 内固定多步顺序。

**Allow（adapter 层，需逐条记录上下文）**：`WorkspaceCommandOrchestrator.executeModelTool()`、`PiSkillManager.executeModelTool()` 的工具分派；`workspace.ts` 领域 instruction parser；Replay/cache 为幂等所需的工具实现细节。Allow 代码不得创建/修改 Plan steps 或成为 fallback 来源。

审计证据按文件/上下文分类，不以单纯字符串命中判定：Planner、Plan contract、strict Runtime、PI system prompt、adapter dispatch、instruction parser、Replay/cache 各自列 allow/deny 与对应测试。

同时更新 `AGENT.md`：任何 agent 不得在 Planner/Runtime/Agent prompt 中硬编码工具、规则、路由、商品/文件名或验收动作；硬约束只能来自工具契约、版本化策略或真实结果；独立审核 agent 必须执行上述上下文审计，命中 Deny 即阻断。

## 9. 测试与完整 E2E

### 9.1 单元/集成

- 计划合同从 tool metadata 生成；缺 metadata/版本不匹配 fail-closed。
- 顶层/variant JSON Schema required、nested object/array/enum 校验；`workspace_prepare_write` 不再依赖 Planner 内 operation 列表。
- outputFacts 路径、valueType、requiredOnSuccess、provenance、merge 冲突；卡券 batch fact 来自 `workspace.coupon.created.payload.batchId`，binding/automation fact 来自 `workspace.command.completed.payload.result`。
- 严格计划阻止错工具、错变体、尾部批量调用和提前收口；确认、取消、重连、失败重规划、恢复版本不匹配均有断言。
- Provider wire body 不含内部 `plan` 元数据：Chat Completions wire 的 `tools[*].function` 和 Responses wire 的 `tools[*]` 都必须经过同一剥离函数，仅保留 provider schema 字段；内部 `plan` 只能留在 Runtime 内存/事件快照。为两条 wire 分别加入序列化断言，发现 `plan` 字段即失败；adapter dispatch 既有测试保留。
- 迁移旧测试：移除 fallback/SUPPORTED_* 依赖；所有 mock function tool 补 `plan` metadata；新增上述错误码断言。

### 9.2 完整 E2E 脚本

新增 `apps/web/scripts/e2e-workspace-coupon-auto-delivery-postgres.mjs`，复用现有 PostgreSQL/Chrome/CDP fixture：

1. 建管理员、账号和商品，商品标题精确为“AI 技术咨询，需求定制开发服务”。
2. 安装 fixture Skill：catalog → `references/file-share.md`；read 文档；exec `search --name "03 PPT Master"` 返回 fid；exec `share --fid <fid> --title "03 PPT Master"` 返回 `https://share.example.test/03-ppt-master-public`。
3. Model fixture 首轮返回 8 步 Plan：catalog、read、exec(search)、exec(share)、product_search、prepare_write(coupon_create)、prepare_write(coupon_bind)、prepare_write(product_automation_update)。后续每轮仅返回当前步骤 tool call；确认后继续既有 Run。
4. 浏览器真实打开 `/workspace`，输入任务；等待 `[data-testid="workspace-plan-card"]`/`.workspace-plan-float` 与 tool events；当 `.workspace-confirmation-card` 出现时点击其确认按钮（每次循环等待卡片消失和下一步事件）。最终消息 selector 为 `.workspace-message-final`，恰好一个。
5. 卡券创建使用 `purpose='api'` 与 `metadata.apiConfig.url=shareUrl`；不写已删除字段。
6. 数据库断言：

```sql
select sequence_id, status, metadata_json
from coupons.coupon_batches
where account_id=$1 and status <> 'voided';
select product_id, coupon_batch_id, status
from coupons.coupon_bindings
where product_id=$2 and status='active';
select config_version, config_json->'paidAutoDelivery' as paid_auto_delivery
from products.automation_configs
where product_id=$2;
```

7. 断言 Plan/工具顺序与 8 步一致、Confirmation 次数为 3、分享 URL/商品标题/自动发货启用出现在可见结果或可复读数据中、无 `PLAN_*` 失败事件；截图/事件/SQL 输出归档。

### 9.3 本地开发 Codex In-App Browser 验收（独立门禁）

完整 E2E 脚本不是唯一通过条件。启动本地开发 API/Web/PostgreSQL/Redis/对象存储后，必须按 `C:\Users\Chenchen\\.agents\\skills\\codex-inapp-browser\\SKILL.md` 的流程调用 Codex In-App Browser：`cua.initialize()` → `cua.browsers.list()` 选择 `type==='iab'` → 精确选择本地 `/workspace` 标签 → 读取 `tab.url()`、`tab.title()`、`tab.playwright.domSnapshot()`。验收记录必须保存实际 URL、稳定 DOM 选择器计数、可见文本顺序和两次读取之间的稳定性。

Model fixture 的三个写入 tool call 必须使用以下精确 JSON 参数（不能只写自然语言目标）：

```json
[
  {"operation":"coupon_create","parameters":{"label":"03 PPT Master","purpose":"api","apiConfig":{"url":"https://share.example.test/03-ppt-master-public","method":"GET"}}},
  {"operation":"coupon_bind","parameters":{"productId":"<resolved-product-id>","batchId":"<confirmed-batch-id>"}},
  {"operation":"product_automation_update","parameters":{"productId":"<resolved-product-id>","config":{"paidAutoDelivery":{"enabled":true,"couponBatchIds":["<confirmed-batch-id>"]}}}}
]
```

当 `.workspace-confirmation-card` 出现时，IAB agent 必须逐次点击其确认按钮三次，并在每次点击后记录：卡片 action、确认按钮文本、`workspace.confirmation.confirmed` 事件、后续 `workspace.command.completed`/`workspace.coupon.created` 事件及 DOM 卡片消失。最终证据必须包含 `[data-testid="workspace-plan-card"]` 或 `.workspace-plan-float`、三次确认事件、唯一 `.workspace-message-final` 和页面消息流顺序。

数据库验收必须用创建批次的 sequence_id 证明绑定属于同一批次，而不是只按 product_id 看到任意 active binding：

```sql
select b.sequence_id, b.status, b.metadata_json
from coupons.coupon_batches b
where b.account_id=$1 and b.sequence_id=$2 and b.status <> 'voided';
select cb.product_id, cb.coupon_batch_id, cb.status, b.sequence_id
from coupons.coupon_bindings cb
join coupons.coupon_batches b on b.id = cb.coupon_batch_id
where cb.product_id=$3 and b.sequence_id=$2 and cb.status='active';
select ac.config_version, ac.config_json->'paidAutoDelivery' as paid_auto_delivery
from products.automation_configs ac
where ac.product_id=$3 and (ac.config_json->'paidAutoDelivery'->>'enabled')::boolean = true
  and (ac.config_json->'paidAutoDelivery'->'couponBatchIds') ? $4;
```

The IAB acceptance artifact must archive the URL, DOM snapshots before/after each click, click count=3, the final message text, the ordered run events, and the three SQL result sets. Any mismatch is BLOCKED even if the scripted fixture passes.

## 10. 方案审核与编码后审核

编码前独立 agent 必须 PASS：真实代码依据、契约结构、11+ 工具种子、空计划/失败语义、状态机、E2E SQL/selector/fixture、硬编码上下文审计清单全部闭环。

编码后由另一独立 agent 审核：`git diff`、AGENT.md 规则、Plan/Runtime/adapter 边界、wire 剥离、定向测试、类型/构建、完整 E2E 与证据；未 PASS 不合并。

## 11. 回滚

Plan event 新字段保持 JSON 兼容；旧计划无 variant/contractVersion 在恢复时阻塞，不静默执行。回滚只撤销 Planner/Runtime/metadata/test 改动，不回滚已经成功写入的商品、卡券、绑定或自动化配置；外部副作用仍以 Confirmation/Outbox 为准。

## 12. v6 事实校正

- 浏览器计划卡真实 selector 为 `[data-testid="workspace-plan-card"]` / `.workspace-plan-float`；最终消息为 `.workspace-message-final`；Confirmation 卡片为 `.workspace-confirmation-card`。
- `WorkspaceToolPlanVariant` 正式包含必填的 `inputBindings: Array<{ fact: string; paths: Array<\`args.${string}\`>; valueType: 'string'|'number'|'boolean'|'array'|'object'; required: boolean; merge: 'preserve'|'overwrite' }>`；路径语法统一为 `result.data.*`、`result.data.parsed.*`、`event.payload.*` 和 `args.*`，支持点路径与 `[index]`，不执行任意代码。`coupon_create` 只声明 `inputBindings: [{ fact: 'shareUrl', paths: ['args.parameters.apiConfig.url'], valueType: 'string', required: true, merge: 'preserve' }]`，不把 `shareUrl` 再列为 `coupon_create` output fact。Runtime 要求绑定值与已有 fact 相等；若 fact 已存在且值冲突，返回 `PLAN_ARGUMENT_INVALID`；若 fact 不存在但参数值存在，仅在该 binding `required=false` 时建立 provenance，本目标 binding 为 required=true，因此必须先有 Skill share fact。
- 契约种子中的每个 output descriptor 必须显式填写 `valueType`、`requiredOnSuccess`、`merge`、`source`：默认 `requiredOnSuccess=false`、`merge='overwrite'`、`source='tool_result'`，目标链路关键事实 `shareUrl/productId/productTitle/couponBatchId/boundCouponBatchId/boundCouponBatchIds/paidAutoDeliveryEnabled` 设为 `requiredOnSuccess=true`; `productId/productTitle/fid` 只在 `items` 唯一条件成立时提取，条件不成立时 skip 而不是误选或误报输出缺失。
- `workspace_product_search` 只有在 `data.items.length===1` 时产出 `productId/productTitle`；多候选只产出 `candidateItems`，后续 Plan 必须继续澄清/精确搜索，不得从 `items[0]` 误选。
- `PLAN_NOT_REQUIRED` 只允许后续无工具调用的普通模型回答；若模型在空计划路径返回任何 tool call，Runtime 写 `PLAN_STEP_MISMATCH` 并停止。
- `workspace_prepare_write` 的 `argumentSchemas` 由工具声明导出完整 operation 变体：`coupon_create`、`coupon_bind`、`product_automation_update` 以及现有其它 operation；Plan 层只按 discriminator 查 schema，不复制 operation 列表。未知/缺 schema 统一 `PLAN_ARGUMENT_INVALID`。
- Skill 工具契约按真实返回修正：
  - `pi_skill_read/default` 输出 `sourceFile`、`totalChars`、`truncated`，不声明不存在的 `commandEvidence`；
  - `pi_skill_search/default` 输出 `sourceFile`、`commandEvidence`；
  - `pi_skill_authorize/default` 输出 `skillId`、`resultCode`（实际 data 为 `skillId/code`），不声明 `authorized`；
  - `pi_skill_install/default` 输出 `skillId`、`authorized`（来自 `data.item`）；`pi_skill_login/default` 输出 `skillId`、`loginStatus`、`resultCode`；
  - `pi_skill_exec/search` 为 `sideEffect='read'`、`confirmation='none'`、`replay='reusable'`；`pi_skill_exec/share` 为 `sideEffect='external_write'`、`confirmation='none'`、`replay='non_reusable'`（当前 manager 返回 `kind='read'`，不会产生 Confirmation）；install/authorize/login 同样 `confirmation='none'`，与现有 Runtime 行为一致。若未来要求确认，必须先让 adapter 返回 `write_plan` 并补独立迁移/测试，不在本轮隐式改变。
- 完整 E2E 只对三次 `workspace_prepare_write` Confirmation 做 DOM 点击；Skill share 不是 Confirmation，但其真实返回 URL 必须进入 Plan fact 并作为 `coupon_create` 的 input binding。`coupon_bind` 的事实键是单值 `boundCouponBatchId`；`product_automation_update` 的事实键是数组 `boundCouponBatchIds`。

