import type { WorkspaceToolPlanMetadata, WorkspacePlanJsonSchema, WorkspacePlanOutputFact, WorkspacePlanInputBinding } from './workspace-plan-contract.js';

const objectSchema = (properties: Record<string, WorkspacePlanJsonSchema>, required: string[] = [], additionalProperties: boolean | WorkspacePlanJsonSchema = false): WorkspacePlanJsonSchema => ({ type: 'object', properties, required, additionalProperties });
const stringSchema = (extra: WorkspacePlanJsonSchema = {}): WorkspacePlanJsonSchema => ({ type: 'string', ...extra });
const arraySchema = (items?: WorkspacePlanJsonSchema): WorkspacePlanJsonSchema => ({ type: 'array', ...(items ? { items } : {}) });
const fact = (key: string, paths: WorkspacePlanOutputFact['paths'], valueType: WorkspacePlanOutputFact['valueType'], source: WorkspacePlanOutputFact['source'] = 'tool_result', requiredOnSuccess = false, extra: Partial<WorkspacePlanOutputFact> = {}): WorkspacePlanOutputFact => ({ key, paths, valueType, requiredOnSuccess, merge: 'overwrite', source, ...extra });
const binding = (factKey: string, paths: Array<`args.${string}`>, valueType: WorkspacePlanInputBinding['valueType'], required = true): WorkspacePlanInputBinding => ({ fact: factKey, paths, valueType, required, merge: 'preserve' });

export const workspaceReadPlan: WorkspaceToolPlanMetadata = {
  contractVersion: 1,
  default: { sideEffect: 'read', confirmationPolicy: 'none', replay: 'reusable', inputFacts: [], inputBindings: [], outputFacts: [fact('readback', ['result.data'], 'object')], argumentSchema: objectSchema({ instruction: stringSchema() }, ['instruction']) },
};

export const workspaceProductSearchPlan: WorkspaceToolPlanMetadata = {
  contractVersion: 1,
  default: {
    sideEffect: 'read', confirmationPolicy: 'none', replay: 'reusable', inputFacts: [], inputBindings: [],
    outputFacts: [
      fact('productId', ['result.data.productId'], 'string', 'tool_result', true, { condition: { path: 'result.data.items', arrayLengthEquals: 1 }, onConditionFalse: 'skip' }),
      fact('productTitle', ['result.data.items[0].title'], 'string', 'tool_result', true, { condition: { path: 'result.data.items', arrayLengthEquals: 1 }, onConditionFalse: 'skip' }),
      fact('candidateItems', ['result.data.items'], 'array'),
    ],
    argumentSchema: objectSchema({ query: stringSchema() }, ['query']),
  },
};

const couponCreatePlan = {
  sideEffect: 'prepare_write' as const,
  confirmationPolicy: 'required' as const,
  replay: 'non_reusable' as const,
  inputFacts: ['shareUrl'],
  inputBindings: [binding('shareUrl', ['args.parameters.apiConfig.url'], 'string')],
  outputFacts: [fact('couponBatchId', ['event.payload.batchId', 'result.data.batchId'], 'string', 'confirmation_event', true)],
  argumentSchema: objectSchema({
    operation: stringSchema({ enum: ['coupon_create'] }),
    parameters: objectSchema({
      label: stringSchema(),
      purpose: stringSchema({ enum: ['api'] }),
      apiConfig: objectSchema({ url: stringSchema(), method: stringSchema({ enum: ['GET'] }) }, ['url', 'method']),
    }, ['label', 'purpose', 'apiConfig'], true),
  }, ['operation', 'parameters']),
};

const couponBindPlan = {
  sideEffect: 'prepare_write' as const,
  confirmationPolicy: 'required' as const,
  replay: 'non_reusable' as const,
  inputFacts: ['productId', 'couponBatchId'],
  inputBindings: [binding('productId', ['args.parameters.productId'], 'string'), binding('couponBatchId', ['args.parameters.batchId'], 'string')],
  outputFacts: [fact('boundCouponBatchId', ['event.payload.result.binding.batchId', 'event.payload.result.batch.id', 'result.data.binding.batchId'], 'string', 'confirmation_event', true)],
  argumentSchema: objectSchema({
    operation: stringSchema({ enum: ['coupon_bind'] }),
    parameters: objectSchema({ productId: stringSchema(), batchId: stringSchema() }, ['productId', 'batchId'], true),
  }, ['operation', 'parameters']),
};

const automationUpdatePlan = {
  sideEffect: 'prepare_write' as const,
  confirmationPolicy: 'required' as const,
  replay: 'non_reusable' as const,
  inputFacts: ['productId', 'couponBatchId'],
  inputBindings: [binding('productId', ['args.parameters.productId'], 'string'), binding('couponBatchId', ['args.parameters.config.paidAutoDelivery.couponBatchIds[0]'], 'string')],
  outputFacts: [
    fact('configVersion', ['event.payload.result.configVersion', 'result.data.configVersion'], 'number', 'confirmation_event', true),
    fact('paidAutoDeliveryEnabled', ['event.payload.result.config.paidAutoDelivery.enabled', 'result.data.config.paidAutoDelivery.enabled'], 'boolean', 'confirmation_event', true),
    fact('boundCouponBatchIds', ['event.payload.result.config.paidAutoDelivery.couponBatchIds', 'result.data.config.paidAutoDelivery.couponBatchIds'], 'array', 'confirmation_event', true),
  ],
  argumentSchema: objectSchema({
    operation: stringSchema({ enum: ['product_automation_update'] }),
    parameters: objectSchema({
      productId: stringSchema(),
      config: objectSchema({
        paidAutoDelivery: objectSchema({
          enabled: { type: 'boolean' },
          couponBatchIds: arraySchema(stringSchema()),
        }, ['enabled', 'couponBatchIds'], true),
      }, ['paidAutoDelivery'], true),
    }, ['productId', 'config'], true),
  }, ['operation', 'parameters']),
};

export const workspacePrepareWritePlan: WorkspaceToolPlanMetadata = {
  contractVersion: 1,
  discriminator: { field: 'operation', variants: { coupon_create: couponCreatePlan, coupon_bind: couponBindPlan, product_automation_update: automationUpdatePlan } },
  default: { sideEffect: 'prepare_write', confirmationPolicy: 'required', replay: 'non_reusable', inputFacts: [], inputBindings: [], outputFacts: [fact('manifest', ['result.data'], 'object')], argumentSchema: objectSchema({ operation: stringSchema(), parameters: objectSchema({}, [], true), instruction: stringSchema(), productId: stringSchema() }, [], false) },
};

export const piSkillExecPlan: WorkspaceToolPlanMetadata = {
  contractVersion: 1,
  discriminator: {
    field: 'command',
    variants: {
      search: { sideEffect: 'read', confirmationPolicy: 'none', replay: 'reusable', inputFacts: [], inputBindings: [], outputFacts: [fact('fid', ['result.data.parsed.items[0].fid'], 'string', 'tool_result', true, { condition: { path: 'result.data.parsed.items', arrayLengthEquals: 1 }, onConditionFalse: 'skip' }), fact('commandStatus', ['result.data.status'], 'string')], argumentSchema: objectSchema({ skillId: stringSchema(), command: stringSchema({ enum: ['search'] }), args: arraySchema(stringSchema()) }, ['skillId', 'command']) },
      share: { sideEffect: 'external_write', confirmationPolicy: 'none', replay: 'non_reusable', inputFacts: ['fid'], inputBindings: [binding('fid', ['args.args[0]'], 'string')], outputFacts: [fact('shareUrl', ['result.data.parsed.url', 'result.data.parsed.shareUrl'], 'string', 'tool_result', true), fact('commandStatus', ['result.data.status'], 'string')], argumentSchema: objectSchema({ skillId: stringSchema(), command: stringSchema({ enum: ['share'] }), args: arraySchema(stringSchema()) }, ['skillId', 'command']) },
    },
  },
};

export const piSkillListPlan: WorkspaceToolPlanMetadata = { contractVersion: 1, default: { sideEffect: 'read', confirmationPolicy: 'none', replay: 'reusable', inputFacts: [], inputBindings: [], outputFacts: [fact('skillItems', ['result.data.items'], 'array')], argumentSchema: objectSchema({}, []) } };
export const piSkillInstallPlan: WorkspaceToolPlanMetadata = { contractVersion: 1, default: { sideEffect: 'external_write', confirmationPolicy: 'none', replay: 'non_reusable', inputFacts: [], inputBindings: [], outputFacts: [fact('skillId', ['result.data.item.id'], 'string'), fact('authorized', ['result.data.item.authorized'], 'boolean')], argumentSchema: objectSchema({ source: stringSchema(), expectedSha256: stringSchema() }, ['source']) } };
export const piSkillAuthorizePlan: WorkspaceToolPlanMetadata = { contractVersion: 1, default: { sideEffect: 'external_write', confirmationPolicy: 'none', replay: 'non_reusable', inputFacts: [], inputBindings: [], outputFacts: [fact('skillId', ['result.data.skillId'], 'string'), fact('resultCode', ['result.data.code'], 'number')], argumentSchema: objectSchema({ skillId: stringSchema(), token: stringSchema() }, ['skillId', 'token']) } };
export const piSkillLoginPlan: WorkspaceToolPlanMetadata = { contractVersion: 1, default: { sideEffect: 'external_write', confirmationPolicy: 'none', replay: 'non_reusable', inputFacts: [], inputBindings: [], outputFacts: [fact('skillId', ['result.data.skillId'], 'string'), fact('loginStatus', ['result.data.status'], 'string'), fact('resultCode', ['result.data.code'], 'number')], argumentSchema: objectSchema({ skillId: stringSchema(), token: stringSchema(), args: arraySchema(stringSchema()) }, ['skillId']) } };
export const piSkillCatalogPlan: WorkspaceToolPlanMetadata = { contractVersion: 1, default: { sideEffect: 'read', confirmationPolicy: 'none', replay: 'reusable', inputFacts: [], inputBindings: [], outputFacts: [fact('skillId', ['result.data.skillId'], 'string'), fact('documents', ['result.data.documents'], 'array')], argumentSchema: objectSchema({ skillId: stringSchema() }, ['skillId']) } };
export const piSkillReadPlan: WorkspaceToolPlanMetadata = { contractVersion: 1, default: { sideEffect: 'read', confirmationPolicy: 'none', replay: 'reusable', inputFacts: [], inputBindings: [], outputFacts: [fact('sourceFile', ['result.data.sourceFile'], 'string'), fact('totalChars', ['result.data.totalChars'], 'number'), fact('truncated', ['result.data.truncated'], 'boolean')], argumentSchema: objectSchema({ skillId: stringSchema(), filePath: stringSchema() }, ['skillId']) } };
export const piSkillSearchPlan: WorkspaceToolPlanMetadata = { contractVersion: 1, default: { sideEffect: 'read', confirmationPolicy: 'none', replay: 'reusable', inputFacts: [], inputBindings: [], outputFacts: [fact('sourceFile', ['result.data.sourceFile'], 'string'), fact('commandEvidence', ['result.data.commandEvidence'], 'array')], argumentSchema: objectSchema({ skillId: stringSchema(), query: stringSchema(), mode: stringSchema({ enum: ['literal', 'fuzzy', 'regex'] }), filePath: stringSchema(), cursor: stringSchema(), limit: { type: 'integer', minimum: 1, maximum: 50 } }, ['skillId', 'query']) } };

export function workspaceToolPlanMetadataFor(name: string): WorkspaceToolPlanMetadata | undefined {
  switch (name) {
    case 'workspace_read': return workspaceReadPlan;
    case 'workspace_product_search': return workspaceProductSearchPlan;
    case 'workspace_prepare_write': return workspacePrepareWritePlan;
    case 'pi_skill_list': return piSkillListPlan;
    case 'pi_skill_install': return piSkillInstallPlan;
    case 'pi_skill_authorize': return piSkillAuthorizePlan;
    case 'pi_skill_login': return piSkillLoginPlan;
    case 'pi_skill_catalog': return piSkillCatalogPlan;
    case 'pi_skill_read': return piSkillReadPlan;
    case 'pi_skill_search': return piSkillSearchPlan;
    case 'pi_skill_exec': return piSkillExecPlan;
    default: return undefined;
  }
}

export const allWorkspaceToolPlanMetadata = workspaceToolPlanMetadataFor;
