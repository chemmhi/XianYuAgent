export type WorkspacePlanFactKey =
  | 'shareUrl'
  | 'fid'
  | 'productId'
  | 'productTitle'
  | 'couponBatchId'
  | 'configVersion'
  | 'paidAutoDeliveryEnabled'
  | 'boundCouponBatchIds'
  | 'couponBatchActive'
  | 'readbackConfirmed';

export interface WorkspacePlanFacts {
  shareUrl?: string;
  fid?: string;
  productId?: string;
  productTitle?: string;
  couponBatchId?: string;
  configVersion?: number;
  paidAutoDeliveryEnabled?: boolean;
  boundCouponBatchIds?: string[];
  couponBatchActive?: boolean;
  readbackConfirmed?: boolean;
}

export type WorkspacePlanConfirmationPolicy = 'none' | 'required';

export interface WorkspacePlanStepContract {
  action: string;
  requiresFacts: WorkspacePlanFactKey[];
  producesFacts: WorkspacePlanFactKey[];
  confirmationPolicy: WorkspacePlanConfirmationPolicy;
  argPredicateId: string;
}

export interface WorkspacePlanStepLike {
  tool: string;
  goal: string;
  action?: string;
  requiresFacts?: WorkspacePlanFactKey[];
  producesFacts?: WorkspacePlanFactKey[];
  confirmationPolicy?: WorkspacePlanConfirmationPolicy;
  argPredicateId?: string;
}

export interface WorkspacePlanValidationResult {
  ok: boolean;
  code?: string;
  summary?: string;
}

export interface WorkspacePlanGoalStatus {
  predicateId?: string;
  complete: boolean;
  missing: WorkspacePlanFactKey[];
}

const COUPON_SHARE_AUTOMATION_PREDICATE = 'coupon_from_public_share_enable_paid_auto_delivery';

/**
 * The task-specific contract is intentionally deterministic. The model may
 * suggest a sequence, but it cannot remove required discovery, confirmation,
 * or readback steps for this compound task.
 */
export function isCouponShareAutomationTask(instruction: string): boolean {
  const text = instruction.toLowerCase();
  return /(卡券|coupon)/u.test(text)
    && /(自动发货|付费自动发货|paid.?auto.?delivery|auto.?delivery)/u.test(text)
    && /(网盘|分享|公开链接|share|file)/u.test(text)
    && /(商品|产品|product)/u.test(text);
}

export function goalPredicateIdForInstruction(instruction: string): string | undefined {
  return isCouponShareAutomationTask(instruction) ? COUPON_SHARE_AUTOMATION_PREDICATE : undefined;
}

export function canonicalWorkspacePlanSteps(instruction: string, availableTools: string[]): WorkspacePlanStepLike[] | undefined {
  if (!isCouponShareAutomationTask(instruction)) return undefined;
  const required = [
    ['pi_skill_catalog', 'catalog-quarkclouddrive'],
    ['pi_skill_read', 'read-file-share-reference'],
    ['pi_skill_exec', 'search-public-share-file'],
    ['pi_skill_exec', 'create-public-share-link'],
    ['workspace_product_search', 'resolve-exact-product'],
    ['workspace_prepare_write', 'create-coupon-from-public-share'],
    ['workspace_prepare_write', 'enable-paid-auto-delivery'],
    ['workspace_read', 'readback-paid-auto-delivery'],
  ] as const;
  if (required.some(([tool]) => !availableTools.includes(tool))) return undefined;
  return [
    {
      tool: 'pi_skill_catalog',
      goal: '获取夸克网盘 Skill 能力总览和文档索引',
      action: 'catalog',
      requiresFacts: [],
      producesFacts: [],
      confirmationPolicy: 'none',
      argPredicateId: 'catalog-quarkclouddrive',
    },
    {
      tool: 'pi_skill_read',
      goal: '读取 references/file-share.md 的公开分享命令',
      action: 'read-file-share-reference',
      requiresFacts: [],
      producesFacts: [],
      confirmationPolicy: 'none',
      argPredicateId: 'read-file-share-reference',
    },
    {
      tool: 'pi_skill_exec',
      goal: '搜索文件 03 PPT Master 并提取 fid',
      action: 'search-public-share-file',
      requiresFacts: [],
      producesFacts: ['fid'],
      confirmationPolicy: 'none',
      argPredicateId: 'search-public-share-file',
    },
    {
      tool: 'pi_skill_exec',
      goal: '用已解析 fid 创建网盘公开分享链接',
      action: 'create-public-share-link',
      requiresFacts: ['fid'],
      producesFacts: ['shareUrl'],
      confirmationPolicy: 'none',
      argPredicateId: 'create-public-share-link',
    },
    {
      tool: 'workspace_product_search',
      goal: '精确定位商品 AI 技术咨询，需求定制开发服务',
      action: 'resolve-exact-product',
      requiresFacts: [],
      producesFacts: ['productId', 'productTitle'],
      confirmationPolicy: 'none',
      argPredicateId: 'resolve-exact-product',
    },
    {
      tool: 'workspace_prepare_write',
      goal: '准备使用公开分享链接创建卡券并等待确认',
      action: 'coupon_create',
      requiresFacts: ['shareUrl'],
      producesFacts: ['couponBatchId'],
      confirmationPolicy: 'required',
      argPredicateId: 'create-coupon-from-public-share',
    },
    {
      tool: 'workspace_prepare_write',
      goal: '准备启用商品付费自动发货并绑定新卡券批次',
      action: 'product_automation_update',
      requiresFacts: ['productId', 'couponBatchId'],
      producesFacts: ['configVersion', 'paidAutoDeliveryEnabled', 'boundCouponBatchIds'],
      confirmationPolicy: 'required',
      argPredicateId: 'enable-paid-auto-delivery',
    },
    {
      tool: 'workspace_read',
      goal: '复读商品自动化配置并验证目标谓词',
      action: 'readback-paid-auto-delivery',
      requiresFacts: ['productId', 'couponBatchId'],
      producesFacts: ['configVersion', 'paidAutoDeliveryEnabled', 'boundCouponBatchIds', 'couponBatchActive', 'readbackConfirmed'],
      confirmationPolicy: 'none',
      argPredicateId: 'readback-paid-auto-delivery',
    },
  ];
}

export function contractForWorkspaceStep(step: WorkspacePlanStepLike): WorkspacePlanStepContract {
  const action = step.action ?? inferWorkspaceStepAction(step.tool, step.goal);
  const hasExplicitContract = step.action !== undefined
    || step.requiresFacts !== undefined
    || step.producesFacts !== undefined
    || step.confirmationPolicy !== undefined
    || step.argPredicateId !== undefined;
  const argPredicateId = step.argPredicateId;
  const genericSupportedTools = new Set([
    'pi_skill_list',
    'pi_skill_catalog',
    'pi_skill_read',
    'pi_skill_search',
    'pi_skill_exec',
    'workspace_product_search',
    'workspace_read',
    'workspace_prepare_write',
  ]);
  const registered = new Set([
    'pi_skill_catalog|catalog|catalog-quarkclouddrive',
    'pi_skill_read|read-file-share-reference|read-file-share-reference',
    'pi_skill_exec|search-public-share-file|search-public-share-file',
    'pi_skill_exec|create-public-share-link|create-public-share-link',
    'workspace_product_search|resolve-exact-product|resolve-exact-product',
    'workspace_prepare_write|coupon_create|create-coupon-from-public-share',
    'workspace_prepare_write|product_automation_update|enable-paid-auto-delivery',
    'workspace_read|readback-paid-auto-delivery|readback-paid-auto-delivery',
  ]);
  const key = `${step.tool}|${action}|${argPredicateId ?? ''}`;
  if (!hasExplicitContract && action !== 'unknown' && genericSupportedTools.has(step.tool)) {
    return {
      action,
      requiresFacts: [],
      producesFacts: [],
      confirmationPolicy: step.tool === 'workspace_prepare_write' ? 'required' : 'none',
      argPredicateId: `${step.tool}:default`,
    };
  }
  if (!step.action || action === inferWorkspaceStepAction(step.tool, step.goal)) {
    if (action !== 'unknown' && argPredicateId === `${step.tool}:default` && genericSupportedTools.has(step.tool)) {
      return {
        action,
        requiresFacts: step.requiresFacts ?? [],
        producesFacts: step.producesFacts ?? [],
        confirmationPolicy: step.confirmationPolicy ?? (step.tool === 'workspace_prepare_write' ? 'required' : 'none'),
        argPredicateId,
      };
    }
  }
  if (!argPredicateId || !registered.has(key)) {
    return {
      action,
      requiresFacts: step.requiresFacts ?? [],
      producesFacts: step.producesFacts ?? [],
      confirmationPolicy: step.confirmationPolicy ?? (step.tool === 'workspace_prepare_write' ? 'required' : 'none'),
      argPredicateId: 'CONTRACT_MISSING',
    };
  }
  return {
    action,
    requiresFacts: step.requiresFacts ?? [],
    producesFacts: step.producesFacts ?? [],
    confirmationPolicy: step.confirmationPolicy ?? (step.tool === 'workspace_prepare_write' ? 'required' : 'none'),
    argPredicateId,
  };
}

export function inferWorkspaceStepAction(tool: string, goal: string): string {
  const text = `${tool} ${goal}`.toLowerCase();
  if (tool === 'pi_skill_catalog') return 'catalog';
  if (tool === 'pi_skill_read') return 'read';
  if (tool === 'pi_skill_search') return 'search-docs';
  if (tool === 'pi_skill_exec') return /share|公开/u.test(text) ? 'share' : /search|查找|定位/u.test(text) ? 'search' : 'exec';
  if (tool === 'workspace_product_search') return 'product_search';
  if (tool === 'workspace_prepare_write') return /自动发货|automation|规则/u.test(text) ? 'product_automation_update' : /卡券|coupon/u.test(text) ? 'coupon_create' : 'write';
  if (tool === 'workspace_read') return /复读|readback|自动发货|automation|读取|状态/iu.test(text) ? 'readback' : 'unknown';
  return tool;
}

export function validateWorkspacePlanCall(
  step: WorkspacePlanStepLike,
  toolName: string,
  args: Record<string, unknown>,
  facts: WorkspacePlanFacts,
): WorkspacePlanValidationResult {
  const contract = contractForWorkspaceStep(step);
  if (step.tool !== toolName) return { ok: false, code: 'PLAN_STEP_MISMATCH', summary: `Plan Mode 当前步骤要求调用 ${step.tool}，本轮收到 ${toolName}；请按计划顺序继续` };
  if (contract.argPredicateId === 'CONTRACT_MISSING') return { ok: false, code: 'PLAN_CONTRACT_ERROR', summary: `没有为 ${toolName} 当前动作注册确定的输入输出契约` };
  for (const key of contract.requiresFacts) {
    if (!hasFact(facts, key)) return { ok: false, code: 'PLAN_FACT_MISSING', summary: `当前步骤 ${contract.action} 缺少前置事实 ${key}` };
  }
  switch (contract.argPredicateId) {
    case 'catalog-quarkclouddrive':
      return typeof args.skillId === 'string' && /quarkclouddrive/u.test(args.skillId) ? { ok: true } : { ok: false, code: 'PLAN_ARGUMENT_MISMATCH', summary: '夸克网盘能力总览必须使用 quarkclouddrive Skill' };
    case 'read-file-share-reference':
      return typeof args.skillId === 'string' && /quarkclouddrive/u.test(args.skillId) && args.filePath === 'references/file-share.md'
        ? { ok: true }
        : { ok: false, code: 'PLAN_ARGUMENT_MISMATCH', summary: '公开分享文档必须读取 references/file-share.md' };
    case 'search-public-share-file':
      return isSkillExec(args, 'search') && skillArgsContain(args, '03 PPT Master')
        ? { ok: true }
        : { ok: false, code: 'PLAN_ARGUMENT_MISMATCH', summary: '文件搜索必须使用 search 并定位 03 PPT Master' };
    case 'create-public-share-link':
      return isSkillExec(args, 'share') && skillArgsContain(args, facts.fid ?? '')
        ? { ok: true }
        : { ok: false, code: 'PLAN_ARGUMENT_MISMATCH', summary: '公开分享必须使用已解析 fid 调用 share' };
    case 'resolve-exact-product':
      return typeof args.query === 'string' && normalizeText(args.query) === normalizeText('AI 技术咨询，需求定制开发服务')
        ? { ok: true }
        : { ok: false, code: 'PLAN_ARGUMENT_MISMATCH', summary: '商品搜索必须使用精确商品标题' };
    case 'create-coupon-from-public-share':
      return validateCouponCreateArgs(args, facts);
    case 'enable-paid-auto-delivery':
      return validateAutomationArgs(args, facts);
    case 'readback-paid-auto-delivery':
      return typeof args.instruction === 'string'
        && /自动发货|automation|配置|复读|读取/u.test(args.instruction)
        && args.instruction.includes(facts.productId ?? '')
        && args.instruction.includes(facts.couponBatchId ?? '')
        ? { ok: true }
        : { ok: false, code: 'PLAN_ARGUMENT_MISMATCH', summary: '最后一步必须读取商品自动化配置完成复核' };
    default:
      return { ok: true };
  }
}

export function extractWorkspacePlanFacts(toolName: string, args: Record<string, unknown>, result: unknown): WorkspacePlanFacts {
  const serialized = safeSerialize(result);
  const facts: WorkspacePlanFacts = {};
  if (toolName === 'pi_skill_exec') {
    const command = typeof args.command === 'string' ? args.command : '';
    if (command === 'search') {
      const fid = firstStringDeep(result, ['fid', 'fileId'])
        ?? serialized.match(/["']?(?:fid|fileId)["']?\s*[:=]\s*["']?([A-Za-z0-9_-]+)/iu)?.[1];
      if (fid) facts.fid = fid;
    }
    if (command === 'share') {
      const shareUrl = firstUrl(result) ?? firstString(result, ['shareUrl', 'url', 'link']);
      if (shareUrl) facts.shareUrl = shareUrl;
    }
  }
  if (toolName === 'workspace_product_search') {
    const item = firstProduct(result);
    if (item?.id) facts.productId = item.id;
    if (item?.title) facts.productTitle = item.title;
  }
  if (toolName === 'workspace_prepare_write' || toolName === 'workspace_read') {
    const data = firstRecord(result, ['data', 'config', 'result']);
    const config = firstRecord(data, ['config']) ?? data;
    const paid = firstRecord(config, ['paidAutoDelivery']);
    if (paid) {
      if (typeof paid.enabled === 'boolean') facts.paidAutoDeliveryEnabled = paid.enabled;
      if (Array.isArray(paid.couponBatchIds)) facts.boundCouponBatchIds = paid.couponBatchIds.map(String).filter(Boolean);
    }
    const version = firstNumber(result, ['configVersion']) ?? firstNumber(data, ['configVersion']);
    if (version !== undefined) facts.configVersion = version;
    const batchId = firstString(result, ['batchId', 'couponBatchId']) ?? firstString(data, ['batchId', 'couponBatchId']);
    if (batchId) facts.couponBatchId = batchId;
    if (toolName === 'workspace_read' && isCanonicalReadbackArgs(args)) {
      facts.readbackConfirmed = true;
      const couponBatchActive = data?.couponBatchActive;
      if (typeof couponBatchActive === 'boolean') facts.couponBatchActive = couponBatchActive;
      else if (Array.isArray(data?.couponBatches)) {
        const couponBatches = data.couponBatches;
        facts.couponBatchActive = couponBatches.length > 0
          && couponBatches.every((batch) => isRecord(batch) && batch.status === 'active');
      }
    }
  }
  return facts;
}

export function extractWorkspacePlanFactsFromEvent(eventType: string, payload: Record<string, unknown>): WorkspacePlanFacts {
  const facts: WorkspacePlanFacts = {};
  if (eventType === 'workspace.coupon.created' && payload.status === 'succeeded') {
    const batchId = firstString(payload, ['batchId', 'couponBatchId']);
    if (batchId) facts.couponBatchId = batchId;
    facts.couponBatchActive = true;
  }
  if (eventType === 'workspace.command.completed' && payload.status === 'succeeded') {
    const result = firstRecord(payload, ['result']);
    Object.assign(facts, extractWorkspacePlanFacts('workspace_prepare_write', {}, result ?? payload));
  }
  if (eventType === 'tool.result' && payload.status === 'succeeded') {
    const toolName = typeof payload.toolName === 'string' ? payload.toolName : '';
    const args = firstRecord(payload, ['args']);
    if (!args) return facts;
    Object.assign(facts, extractWorkspacePlanFacts(toolName, args, payload.result));
  }
  return facts;
}

export function mergeWorkspacePlanFacts(base: WorkspacePlanFacts | undefined, patch: WorkspacePlanFacts): WorkspacePlanFacts {
  const next: WorkspacePlanFacts = { ...(base ?? {}) };
  for (const key of Object.keys(patch) as WorkspacePlanFactKey[]) {
    const value = patch[key];
    if (value === undefined) continue;
    if (key === 'boundCouponBatchIds' && patch.readbackConfirmed !== true) {
      const incoming = Array.isArray(value) ? value : [];
      next[key] = [...new Set([...(next[key] ?? []), ...incoming])];
    } else if (key === 'boundCouponBatchIds') next[key] = Array.isArray(value) ? [...value] : [];
    else next[key] = value as never;
  }
  return next;
}

export function workspacePlanGoalStatus(predicateId: string | undefined, facts: WorkspacePlanFacts | undefined): WorkspacePlanGoalStatus {
  if (predicateId !== COUPON_SHARE_AUTOMATION_PREDICATE) return { predicateId, complete: true, missing: [] };
  const current = facts ?? {};
  const missing: WorkspacePlanFactKey[] = [];
  if (!current.shareUrl) missing.push('shareUrl');
  if (!current.couponBatchId) missing.push('couponBatchId');
  if (!current.productId) missing.push('productId');
  if (current.productTitle !== 'AI 技术咨询，需求定制开发服务') missing.push('productTitle');
  if (current.configVersion === undefined) missing.push('configVersion');
  if (current.couponBatchActive !== true) missing.push('couponBatchActive');
  if (current.paidAutoDeliveryEnabled !== true) missing.push('paidAutoDeliveryEnabled');
  if (current.readbackConfirmed !== true) missing.push('readbackConfirmed');
  if (!current.boundCouponBatchIds?.includes(current.couponBatchId ?? '')) missing.push('boundCouponBatchIds');
  return { predicateId, complete: missing.length === 0, missing };
}

export function planStepRequiresConfirmation(step: WorkspacePlanStepLike): boolean {
  return contractForWorkspaceStep(step).confirmationPolicy === 'required';
}

function hasFact(facts: WorkspacePlanFacts, key: WorkspacePlanFactKey): boolean {
  const value = facts[key];
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== '';
}

function validateCouponCreateArgs(args: Record<string, unknown>, facts: WorkspacePlanFacts): WorkspacePlanValidationResult {
  if (typeof args.operation !== 'string' || args.operation !== 'coupon_create') return { ok: false, code: 'PLAN_ARGUMENT_MISMATCH', summary: '卡券创建步骤必须使用 coupon_create 操作' };
  const parameters = recordParam(args);
  if (typeof parameters.label !== 'string' || !parameters.label.trim()) return { ok: false, code: 'PLAN_ARGUMENT_MISMATCH', summary: '卡券创建必须提供非空 label' };
  const purpose = typeof parameters.purpose === 'string' ? parameters.purpose : '';
  if (purpose !== 'text' && purpose !== 'data') return { ok: false, code: 'PLAN_ARGUMENT_MISMATCH', summary: '公开分享卡券必须使用 text 或 data 类型' };
  const metadata = firstRecord(parameters, ['metadata']) ?? parameters;
  const contentKey = purpose === 'text' ? 'textContent' : 'dataContent';
  const content = typeof metadata[contentKey] === 'string' ? metadata[contentKey] : '';
  if (!content || !facts.shareUrl || !content.includes(facts.shareUrl)) return { ok: false, code: 'PLAN_ARGUMENT_MISMATCH', summary: `卡券 ${contentKey} 必须包含已生成的公开分享 URL` };
  return { ok: true };
}

function validateAutomationArgs(args: Record<string, unknown>, facts: WorkspacePlanFacts): WorkspacePlanValidationResult {
  if (typeof args.operation !== 'string' || args.operation !== 'product_automation_update') return { ok: false, code: 'PLAN_ARGUMENT_MISMATCH', summary: '自动发货步骤必须使用 product_automation_update 操作' };
  const parameters = recordParam(args);
  if (String(parameters.productId ?? args.productId ?? '') !== facts.productId) return { ok: false, code: 'PLAN_ARGUMENT_MISMATCH', summary: '自动发货配置必须复用已解析的 productId' };
  const config = firstRecord(parameters, ['config']);
  const paid = firstRecord(config, ['paidAutoDelivery']);
  if (paid?.enabled !== true) return { ok: false, code: 'PLAN_ARGUMENT_MISMATCH', summary: '自动发货配置必须显式启用 paidAutoDelivery' };
  const ids = Array.isArray(paid.couponBatchIds) ? paid.couponBatchIds.map(String) : [];
  return ids.includes(facts.couponBatchId ?? '') ? { ok: true } : { ok: false, code: 'PLAN_ARGUMENT_MISMATCH', summary: '自动发货配置必须绑定刚创建的 couponBatchId' };
}

function isSkillExec(args: Record<string, unknown>, command: string): boolean {
  return args.command === command && typeof args.skillId === 'string' && /quarkclouddrive/u.test(args.skillId);
}

function skillArgsContain(args: Record<string, unknown>, value: string): boolean {
  return Array.isArray(args.args) && args.args.some((item) => String(item) === value);
}

function recordParam(args: Record<string, unknown>): Record<string, unknown> {
  const parameters = args.parameters;
  return parameters && typeof parameters === 'object' && !Array.isArray(parameters) ? parameters as Record<string, unknown> : args;
}

function firstRecord(value: unknown, keys: string[]): Record<string, unknown> | undefined {
  const root = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  if (!root) return undefined;
  for (const key of keys) {
    const candidate = root[key];
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) return candidate as Record<string, unknown>;
  }
  return root;
}

function firstString(value: unknown, keys: string[]): string | undefined {
  const root = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  if (!root) return undefined;
  for (const key of keys) if (typeof root[key] === 'string' && root[key].trim()) return root[key].trim();
  return undefined;
}

function firstStringDeep(value: unknown, keys: string[], depth = 0): string | undefined {
  if (depth > 8 || value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    try { return firstStringDeep(JSON.parse(value), keys, depth + 1); } catch { return undefined; }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstStringDeep(item, keys, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  for (const key of keys) {
    if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim();
  }
  for (const child of Object.values(value)) {
    const found = firstStringDeep(child, keys, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function firstNumber(value: unknown, keys: string[]): number | undefined {
  const root = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  if (!root) return undefined;
  for (const key of keys) if (typeof root[key] === 'number' && Number.isFinite(root[key])) return root[key];
  return undefined;
}

function firstProduct(value: unknown): { id?: string; title?: string } | undefined {
  const root = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  const data = root && valueRecord(root.data);
  const items = data && Array.isArray(data.items) ? data.items : undefined;
  const candidate = items?.find((item) => item && typeof item === 'object' && !Array.isArray(item)) as Record<string, unknown> | undefined;
  if (!candidate) return undefined;
  return { id: typeof candidate.id === 'string' ? candidate.id : typeof candidate.productId === 'string' ? candidate.productId : undefined, title: typeof candidate.title === 'string' ? candidate.title : undefined };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isCanonicalReadbackArgs(args: Record<string, unknown>): boolean {
  const instruction = typeof args.instruction === 'string' ? args.instruction : '';
  return /自动发货|automation|配置|复读|读取/u.test(instruction)
    && /(?:商品|product(?:Id)?)[\s:：=]+[A-Za-z0-9_-]+/i.test(instruction)
    && /couponBatchId\s*[:：=]/i.test(instruction);
}

function valueRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function firstUrl(value: unknown): string | undefined {
  const serialized = safeSerialize(value);
  return serialized.match(/https?:\/\/[^\s"'\\]+/u)?.[0];
}

function safeSerialize(value: unknown): string {
  try { return JSON.stringify(value) ?? ''; } catch { return String(value ?? ''); }
}

function normalizeText(value: string): string {
  return value.normalize('NFKC').replace(/[\s，,。.!！？?、:：;；'"“”‘’()（）【】\[\]{}]/gu, '').toLowerCase();
}
