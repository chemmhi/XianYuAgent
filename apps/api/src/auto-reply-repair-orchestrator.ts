import { OutcomeReviewEngine, type OutcomeEvidence, type OutcomeReviewPolicy, type OutcomeReviewRecord } from './auto-reply-outcome-review.js';
import { PreSendReviewEngine, type PreSendReviewPolicyInput, type PreSendReviewResult, type PreSendReviewInput } from './auto-reply-pre-send-review.js';
import { PolicyEngine, type PolicyEvaluationInput, type PolicyEvaluationResult } from './auto-reply-policy.js';
import type { ActionPlan, PolicyConfig } from './domain.js';

export interface RepairOrchestratorInput {
  policyConfig: PolicyConfig;
  preSendPolicy: PreSendReviewPolicyInput | undefined;
  outcomePolicy: OutcomeReviewPolicy | undefined;
  policyEvaluation: PolicyEvaluationInput;
  preSend: Omit<PreSendReviewInput, 'actionPlan' | 'policy'> & { verifiedFacts: readonly PreSendReviewInput['verifiedFacts'][number][] };
  send: (input: { actionPlan: ActionPlan; review: PreSendReviewResult }) => Promise<{ outcome: 'simulated' | 'known_success' | 'known_failure' | 'unknown'; externalMessageRef?: string }>;
  now?: Date;
}

export interface RepairOrchestratorResult {
  policy: PolicyEvaluationResult;
  preSend: PreSendReviewResult;
  senderOutcome?: 'simulated' | 'known_success' | 'known_failure' | 'unknown';
  externalMessageRef?: string;
  outcomeReview?: OutcomeReviewRecord;
  sent: boolean;
}

export class AutoReplyRepairOrchestrator {
  constructor(
    private readonly policyEngineFactory: (config: PolicyConfig) => PolicyEngine = (config) => new PolicyEngine(config),
    private readonly preSendEngine = new PreSendReviewEngine(),
    private readonly outcomeEngine = new OutcomeReviewEngine(),
  ) {}

  async execute(input: RepairOrchestratorInput): Promise<RepairOrchestratorResult> {
    const now = input.now ?? new Date();
    const policy = this.policyEngineFactory(input.policyConfig);
    const decision = policy.evaluate({ ...input.policyEvaluation, now });
    const preSend = this.preSendEngine.review({ ...input.preSend, actionPlan: decision.actionPlan, policy: input.preSendPolicy, now });
    if (preSend.decision !== 'APPROVE') return { policy: decision, preSend, sent: false };

    const sent = await input.send({ actionPlan: decision.actionPlan, review: preSend });
    const evidence: OutcomeEvidence[] = sent.outcome === 'known_success' || sent.outcome === 'simulated'
      ? [{ evidenceId: `sender:${decision.actionPlan.actionPlanId}`, type: 'SENDER_PERSISTED', observedAt: now.toISOString(), sourceEventId: decision.actionPlan.actionPlanId, summary: 'sender outcome persisted' }]
      : [];
    const outcomeReview = this.outcomeEngine.createPending({ accountId: input.preSend.scope.accountId, conversationId: input.preSend.scope.conversationId, runId: input.preSend.runId, goalId: input.preSend.goalId, stateId: input.preSend.stateId, expectedStateVersion: input.policyEvaluation.conversationState.stateVersion, policy: input.outcomePolicy, now, idempotencyKey: `outcome:${input.preSend.runId}` });
    return { policy: decision, preSend, senderOutcome: sent.outcome, externalMessageRef: sent.externalMessageRef, outcomeReview: { ...outcomeReview, evidenceRefs: evidence.map((item) => item.evidenceId), evidenceTypes: evidence.map((item) => item.type) }, sent: true };
  }
}
