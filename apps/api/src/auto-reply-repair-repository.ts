import type { ConversationState, Store } from './domain.js';

export interface PersistedRepairReviewRecord {
  reviewId: string;
  accountId: string;
  conversationId: string;
  runId: string;
  goalId: string;
  stateId: string;
  reviewType: 'PRE_SEND' | 'OUTCOME';
  decision?: string;
  resolutionStatus: string;
  reasonCodes: string[];
  evidenceRefs: string[];
  evidenceTypes: string[];
  evidenceWindowStart?: string;
  evidenceWindowEnd?: string;
  reviewerSource: string;
  attempt: number;
  claimKey?: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  idempotencyKey: string;
  reviewedAt?: string;
  nextReviewAt?: string;
  nextAction?: string;
  overrideBy?: string;
  overrideRejected?: boolean;
  expectedStateVersion: number;
  supersedesReviewId?: string;
  deadLetteredAt?: string;
  resolvedAt?: string;
  closedAt?: string;
}

export interface PersistedRepairReviewEvent {
  eventId: string;
  reviewId: string;
  accountId: string;
  conversationId: string;
  eventType: string;
  sourceEventId: string;
  sourceSequence: number;
  stateVersion: number;
  policyVersion: string;
  idempotencyKey: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

interface PoolLike {
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }>;
  connect?(): Promise<PoolClientLike>;
}

interface PoolClientLike extends PoolLike {
  release(): void;
}

export interface PersistedRepairArtifact {
  review: PersistedRepairReviewRecord;
  event: PersistedRepairReviewEvent;
}

export type PersistedReviewMutationStatus = 'updated' | 'idempotent' | 'cas_conflict' | 'lease_lost' | 'not_found' | 'rejected';

export interface PersistedReviewMutationResult {
  status: PersistedReviewMutationStatus;
  record?: PersistedRepairReviewRecord;
}

const memoryStates = new WeakMap<object, Map<string, ConversationState>>();
const memoryReviews = new WeakMap<object, Map<string, PersistedRepairReviewRecord>>();
const memoryEvents = new WeakMap<object, Map<string, PersistedRepairReviewEvent>>();

export class AutoReplyRepairRepository {
  private readonly pool?: PoolLike;

  constructor(private readonly store: Store) {
    this.pool = (store as Store & { pool?: PoolLike }).pool;
  }

  async getConversationState(accountId: string, conversationId: string): Promise<ConversationState | undefined> {
    if (this.pool) {
      const result = await this.pool.query('select * from auto_reply_conversation_state where account_id=$1 and conversation_id=$2 limit 1', [accountId, conversationId]);
      return result.rows[0] ? toState(result.rows[0]) : undefined;
    }
    const state = memoryStates.get(this.store)?.get(key(accountId, conversationId));
    return state ? cloneState(state) : undefined;
  }

  async saveConversationState(state: ConversationState, expectedStateVersion: number): Promise<boolean> {
    if (this.pool) {
      return persistStateQuery(this.pool, state, expectedStateVersion);
    }
    const states = memoryStates.get(this.store) ?? new Map<string, ConversationState>();
    const stateKey = key(state.accountId, state.conversationId);
    const current = states.get(stateKey);
    if (current && current.stateVersion !== expectedStateVersion) return false;
    if (!current && expectedStateVersion !== 0) return false;
    states.set(stateKey, cloneState(state));
    memoryStates.set(this.store, states);
    return true;
  }

  async persistShadowArtifacts(input: { state: ConversationState; expectedStateVersion: number; artifacts: PersistedRepairArtifact[] }): Promise<void> {
    if (!this.pool) {
      const saved = await this.saveConversationState(input.state, input.expectedStateVersion);
      if (!saved) throw new Error('REPAIR_STATE_VERSION_CONFLICT');
      for (const artifact of input.artifacts) {
        if (await this.insertReview(artifact.review)) await this.insertReviewEvent(artifact.event);
      }
      return;
    }

    if (!this.pool.connect) {
      const saved = await this.saveConversationState(input.state, input.expectedStateVersion);
      if (!saved) throw new Error('REPAIR_STATE_VERSION_CONFLICT');
      for (const artifact of input.artifacts) {
        if (await this.insertReview(artifact.review)) await this.insertReviewEvent(artifact.event);
      }
      return;
    }

    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const saved = await persistStateQuery(client, input.state, input.expectedStateVersion);
      if (!saved) throw new Error('REPAIR_STATE_VERSION_CONFLICT');
      for (const artifact of input.artifacts) {
        const inserted = await insertReviewQuery(client, artifact.review);
        if (inserted) await insertReviewEventQuery(client, artifact.event);
      }
      await client.query('commit');
    } catch (error) {
      try { await client.query('rollback'); } catch { /* preserve original failure */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async insertReview(record: PersistedRepairReviewRecord): Promise<boolean> {
    if (this.pool) {
      return insertReviewQuery(this.pool, record);
    }
    const reviews = memoryReviews.get(this.store) ?? new Map<string, PersistedRepairReviewRecord>();
    const reviewKey = `${record.accountId}:${record.idempotencyKey}`;
    if (reviews.has(reviewKey)) return false;
    reviews.set(reviewKey, cloneReview(record));
    memoryReviews.set(this.store, reviews);
    return true;
  }

  async insertReviewEvent(event: PersistedRepairReviewEvent): Promise<boolean> {
    if (this.pool) {
      return insertReviewEventQuery(this.pool, event);
    }
    const events = memoryEvents.get(this.store) ?? new Map<string, PersistedRepairReviewEvent>();
    const eventKey = `${event.accountId}:${event.conversationId}:${event.idempotencyKey}`;
    if (events.has(eventKey)) return false;
    events.set(eventKey, { ...event, payload: { ...event.payload } });
    memoryEvents.set(this.store, events);
    return true;
  }

  async listReviews(accountId: string, conversationId: string): Promise<PersistedRepairReviewRecord[]> {
    if (this.pool) {
      const result = await this.pool.query(`select * from auto_reply_review_records
        where account_id=$1 and conversation_id=$2
        order by case review_type when 'PRE_SEND' then 0 when 'OUTCOME' then 1 else 2 end,
                 created_at asc, review_id asc`, [accountId, conversationId]);
      return result.rows.map(toReview);
    }
    return [...(memoryReviews.get(this.store)?.values() ?? [])].filter((item) => item.accountId === accountId && item.conversationId === conversationId).map(cloneReview);
  }

  async listReviewEvents(accountId: string, conversationId: string): Promise<PersistedRepairReviewEvent[]> {
    if (this.pool) {
      const result = await this.pool.query('select * from auto_reply_review_events where account_id=$1 and conversation_id=$2 order by occurred_at asc, event_id asc', [accountId, conversationId]);
      return result.rows.map(toReviewEvent);
    }
    return [...(memoryEvents.get(this.store)?.values() ?? [])]
      .filter((item) => item.accountId === accountId && item.conversationId === conversationId)
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.eventId.localeCompare(right.eventId))
      .map((item) => ({ ...item, payload: { ...item.payload } }));
  }

  async getReview(reviewId: string): Promise<PersistedRepairReviewRecord | undefined> {
    if (this.pool) {
      const result = await this.pool.query('select * from auto_reply_review_records where review_id=$1 limit 1', [reviewId]);
      return result.rows[0] ? toReview(result.rows[0]) : undefined;
    }
    const record = [...(memoryReviews.get(this.store)?.values() ?? [])].find((item) => item.reviewId === reviewId);
    return record ? cloneReview(record) : undefined;
  }

  async listClaimableOutcomeReviews(input: { limit?: number; now?: string; accountId?: string } = {}): Promise<PersistedRepairReviewRecord[]> {
    const now = input.now ?? new Date().toISOString();
    const limit = Math.max(1, Math.min(100, Math.trunc(input.limit ?? 10)));
    if (this.pool) {
      const result = await this.pool.query(`select * from auto_reply_review_records
        where review_type='OUTCOME' and resolution_status='review_pending'
          and (next_review_at is null or next_review_at <= $1::timestamptz)
          and (lease_expires_at is null or lease_expires_at <= $1::timestamptz)
          ${input.accountId ? 'and account_id=$3' : ''}
        order by coalesce(next_review_at, created_at) asc, created_at asc, review_id asc
        limit $2`, input.accountId ? [now, limit, input.accountId] : [now, limit]);
      return result.rows.map(toReview);
    }
    const nowMs = Date.parse(now);
    return [...(memoryReviews.get(this.store)?.values() ?? [])]
      .filter((item) => item.reviewType === 'OUTCOME' && item.resolutionStatus === 'review_pending')
      .filter((item) => !input.accountId || item.accountId === input.accountId)
      .filter((item) => !item.nextReviewAt || Date.parse(item.nextReviewAt) <= nowMs)
      .filter((item) => !item.leaseExpiresAt || Date.parse(item.leaseExpiresAt) <= nowMs)
      .sort((left, right) => (left.nextReviewAt ?? left.reviewedAt ?? left.idempotencyKey).localeCompare(right.nextReviewAt ?? right.reviewedAt ?? right.idempotencyKey) || left.reviewId.localeCompare(right.reviewId))
      .slice(0, limit)
      .map(cloneReview);
  }

  async claimOutcomeReview(input: {
    reviewId: string;
    workerId: string;
    claimKey: string;
    leaseSeconds: number;
    expectedStateVersion: number;
    event: PersistedRepairReviewEvent;
    now?: string;
  }): Promise<PersistedReviewMutationResult> {
    const now = input.now ?? new Date().toISOString();
    const leaseSeconds = Math.max(1, Math.trunc(input.leaseSeconds));
    const leaseExpiresAt = new Date(Date.parse(now) + leaseSeconds * 1_000).toISOString();
    if (this.pool && this.pool.connect) {
      const client = await this.pool.connect();
      try {
        await client.query('begin');
        const current = await selectReviewForUpdate(client, input.reviewId);
        if (!current) { await client.query('rollback'); return { status: 'not_found' }; }
        if (current.reviewType !== 'OUTCOME') { await client.query('rollback'); return { status: 'rejected', record: current }; }
        if (current.expectedStateVersion !== input.expectedStateVersion) { await client.query('rollback'); return { status: 'cas_conflict', record: current }; }
        const stateVersion = await selectStateVersion(client, current.accountId, current.conversationId);
        if (stateVersion === undefined || stateVersion !== input.expectedStateVersion) { await client.query('rollback'); return { status: 'cas_conflict', record: current }; }
        if (current.resolutionStatus !== 'review_pending') { await client.query('rollback'); return current.claimKey === input.claimKey ? { status: 'idempotent', record: current } : { status: 'lease_lost', record: current }; }
        if (current.leaseExpiresAt && Date.parse(current.leaseExpiresAt) > Date.parse(now)) { await client.query('rollback'); return { status: 'lease_lost', record: current }; }
        const claimed: PersistedRepairReviewRecord = { ...current, resolutionStatus: 'reviewing', claimKey: input.claimKey, leaseOwner: input.workerId, leaseExpiresAt, attempt: current.attempt + 1 };
        const updated = await updateReviewQuery(client, claimed);
        if (!updated) { await client.query('rollback'); return { status: 'cas_conflict', record: current }; }
        await insertReviewEventQuery(client, input.event);
        await client.query('commit');
        return { status: 'updated', record: claimed };
      } catch (error) {
        try { await client.query('rollback'); } catch { /* preserve original failure */ }
        throw error;
      } finally { client.release(); }
    }
    const current = await this.getReview(input.reviewId);
    if (!current) return { status: 'not_found' };
    if (current.reviewType !== 'OUTCOME') return { status: 'rejected', record: current };
    const state = await this.getConversationState(current.accountId, current.conversationId);
    if (!state || state.stateVersion !== input.expectedStateVersion || current.expectedStateVersion !== input.expectedStateVersion) return { status: 'cas_conflict', record: current };
    if (current.resolutionStatus !== 'review_pending') return current.claimKey === input.claimKey ? { status: 'idempotent', record: current } : { status: 'lease_lost', record: current };
    if (current.leaseExpiresAt && Date.parse(current.leaseExpiresAt) > Date.parse(now)) return { status: 'lease_lost', record: current };
    const claimed = { ...current, resolutionStatus: 'reviewing', claimKey: input.claimKey, leaseOwner: input.workerId, leaseExpiresAt, attempt: current.attempt + 1 };
    if (hasEvent(this.store, input.event)) return { status: 'idempotent', record: current };
    replaceMemoryReview(this.store, claimed);
    await this.insertReviewEvent(input.event);
    return { status: 'updated', record: claimed };
  }

  async heartbeatOutcomeReview(input: { reviewId: string; workerId: string; claimKey: string; leaseSeconds: number; now?: string }): Promise<boolean> {
    const now = input.now ?? new Date().toISOString();
    const leaseExpiresAt = new Date(Date.parse(now) + Math.max(1, Math.trunc(input.leaseSeconds)) * 1_000).toISOString();
    if (this.pool) {
      const result = await this.pool.query(`update auto_reply_review_records
        set lease_expires_at=$4::timestamptz, updated_at=now()
        where review_id=$1 and resolution_status='reviewing' and lease_owner=$2 and claim_key=$3 and lease_expires_at > $5::timestamptz`, [input.reviewId, input.workerId, input.claimKey, leaseExpiresAt, now]);
      return (result.rowCount ?? 0) > 0;
    }
    const record = await this.getReview(input.reviewId);
    if (!record || record.resolutionStatus !== 'reviewing' || record.leaseOwner !== input.workerId || record.claimKey !== input.claimKey || !record.leaseExpiresAt || Date.parse(record.leaseExpiresAt) <= Date.parse(now)) return false;
    replaceMemoryReview(this.store, { ...record, leaseExpiresAt });
    return true;
  }

  async applyOutcomeReviewMutation(input: { record: PersistedRepairReviewRecord; event: PersistedRepairReviewEvent; workerId?: string; claimKey?: string }): Promise<PersistedReviewMutationResult> {
    const record = input.record;
    if (this.pool && this.pool.connect) {
      const client = await this.pool.connect();
      try {
        await client.query('begin');
        const current = await selectReviewForUpdate(client, record.reviewId);
        if (!current) { await client.query('rollback'); return { status: 'not_found' }; }
        if (current.reviewType !== 'OUTCOME') { await client.query('rollback'); return { status: 'rejected', record: current }; }
        if (current.idempotencyKey === record.idempotencyKey && current.reviewedAt && record.reviewedAt && current.reviewedAt === record.reviewedAt && current.resolutionStatus === record.resolutionStatus) { await client.query('rollback'); return { status: 'idempotent', record: current }; }
        const stateVersion = await selectStateVersion(client, current.accountId, current.conversationId);
        if (stateVersion === undefined || stateVersion !== record.expectedStateVersion || current.expectedStateVersion !== record.expectedStateVersion) { await client.query('rollback'); return { status: 'cas_conflict', record: current }; }
        if (input.workerId && (current.leaseOwner !== input.workerId || current.claimKey !== input.claimKey || !current.leaseExpiresAt || Date.parse(current.leaseExpiresAt) <= Date.now())) { await client.query('rollback'); return { status: 'lease_lost', record: current }; }
        const updated = await updateReviewQuery(client, record);
        if (!updated) { await client.query('rollback'); return { status: 'cas_conflict', record: current }; }
        await insertReviewEventQuery(client, input.event);
        await client.query('commit');
        return { status: 'updated', record };
      } catch (error) {
        try { await client.query('rollback'); } catch { /* preserve original failure */ }
        throw error;
      } finally { client.release(); }
    }
    const current = await this.getReview(record.reviewId);
    if (!current) return { status: 'not_found' };
    if (current.reviewType !== 'OUTCOME') return { status: 'rejected', record: current };
    if (current.resolutionStatus === record.resolutionStatus && current.reviewedAt && record.reviewedAt && current.reviewedAt === record.reviewedAt) return { status: 'idempotent', record: current };
    const state = await this.getConversationState(current.accountId, current.conversationId);
    if (!state || state.stateVersion !== record.expectedStateVersion || current.expectedStateVersion !== record.expectedStateVersion) return { status: 'cas_conflict', record: current };
    if (input.workerId && (current.leaseOwner !== input.workerId || current.claimKey !== input.claimKey || !current.leaseExpiresAt || Date.parse(current.leaseExpiresAt) <= Date.now())) return { status: 'lease_lost', record: current };
    if (hasEvent(this.store, input.event)) return { status: 'idempotent', record: current };
    replaceMemoryReview(this.store, record);
    await this.insertReviewEvent(input.event);
    return { status: 'updated', record: cloneReview(record) };
  }
}

async function persistStateQuery(executor: PoolLike, state: ConversationState, expectedStateVersion: number): Promise<boolean> {
  if (expectedStateVersion === 0) {
    const inserted = await executor.query(`insert into auto_reply_conversation_state (state_id,account_id,conversation_id,state_version,active_goal_id,goal_status,observed_stage,target_stage,emotion_snapshot,topic_relation,pending_questions,clarification_round,clarification_attempt_id,last_question_fingerprint,recommendation_state,awaiting_user,awaiting_user_since,awaiting_user_ttl,last_message_id,transition_at,policy_version,last_source_event_id,last_source_sequence,processed_event_ids,processed_idempotency_keys)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb,$12,$13,$14,$15::jsonb,$16,$17,$18,$19,$20,$21,$22,$23,$24::jsonb,$25::jsonb)
      on conflict (account_id,conversation_id) do nothing`, insertStateValues(state));
    return (inserted.rowCount ?? 0) > 0;
  }
  const updated = await executor.query(`update auto_reply_conversation_state set state_version=$4,active_goal_id=$5,goal_status=$6,observed_stage=$7,target_stage=$8,emotion_snapshot=$9::jsonb,topic_relation=$10,pending_questions=$11::jsonb,clarification_round=$12,clarification_attempt_id=$13,last_question_fingerprint=$14,recommendation_state=$15::jsonb,awaiting_user=$16,awaiting_user_since=$17,awaiting_user_ttl=$18,last_message_id=$19,transition_at=$20,policy_version=$21,last_source_event_id=$22,last_source_sequence=$23,processed_event_ids=$24::jsonb,processed_idempotency_keys=$25::jsonb,updated_at=now() where account_id=$2 and conversation_id=$3 and state_version=$1`, stateValues(state, expectedStateVersion));
  return (updated.rowCount ?? 0) > 0;
}

async function insertReviewQuery(executor: PoolLike, record: PersistedRepairReviewRecord): Promise<boolean> {
  const result = await executor.query(`insert into auto_reply_review_records (review_id,account_id,conversation_id,run_id,goal_id,state_id,review_type,decision,resolution_status,reason_codes,evidence_refs,evidence_types,evidence_window_start,evidence_window_end,reviewer_source,attempt,claim_key,lease_owner,lease_expires_at,idempotency_key,reviewed_at,next_review_at,next_action,override_by,override_rejected,expected_state_version,supersedes_review_id,dead_lettered_at,resolved_at,closed_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)
    on conflict (account_id,idempotency_key) do nothing`, reviewValues(record));
  return (result.rowCount ?? 0) > 0;
}

async function insertReviewEventQuery(executor: PoolLike, event: PersistedRepairReviewEvent): Promise<boolean> {
  const result = await executor.query(`insert into auto_reply_review_events (event_id,review_id,account_id,conversation_id,event_type,source_event_id,source_sequence,state_version,policy_version,idempotency_key,occurred_at,payload)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
    on conflict (account_id,conversation_id,idempotency_key) do nothing`, [event.eventId, event.reviewId, event.accountId, event.conversationId, event.eventType, event.sourceEventId, event.sourceSequence, event.stateVersion, event.policyVersion, event.idempotencyKey, event.occurredAt, JSON.stringify(event.payload)]);
  return (result.rowCount ?? 0) > 0;
}

function key(accountId: string, conversationId: string): string { return `${accountId}:${conversationId}`; }

function insertStateValues(state: ConversationState): unknown[] {
  return [state.stateId, state.accountId, state.conversationId, state.stateVersion, state.activeGoalId ?? null, state.goalStatus, state.observedStage ?? null, state.targetStage ?? null, JSON.stringify(state.emotionSnapshot ?? null), state.topicRelation ?? null, JSON.stringify(state.pendingQuestions ?? []), state.clarificationRound, state.clarificationAttemptId ?? null, state.lastQuestionFingerprint ?? null, JSON.stringify(state.recommendationState ?? null), state.awaitingUser, state.awaitingUserSince ?? null, state.awaitingUserTtl ?? null, state.lastMessageId ?? null, state.transitionAt, state.policyVersion ?? null, state.lastSourceEventId ?? null, state.lastSourceSequence, JSON.stringify(state.processedEventIds ?? []), JSON.stringify(state.processedIdempotencyKeys ?? [])];
}

function stateValues(state: ConversationState, expectedStateVersion: number): unknown[] {
  return [expectedStateVersion, state.accountId, state.conversationId, state.stateVersion, state.activeGoalId ?? null, state.goalStatus, state.observedStage ?? null, state.targetStage ?? null, JSON.stringify(state.emotionSnapshot ?? null), state.topicRelation ?? null, JSON.stringify(state.pendingQuestions ?? []), state.clarificationRound, state.clarificationAttemptId ?? null, state.lastQuestionFingerprint ?? null, JSON.stringify(state.recommendationState ?? null), state.awaitingUser, state.awaitingUserSince ?? null, state.awaitingUserTtl ?? null, state.lastMessageId ?? null, state.transitionAt, state.policyVersion ?? null, state.lastSourceEventId ?? null, state.lastSourceSequence, JSON.stringify(state.processedEventIds ?? []), JSON.stringify(state.processedIdempotencyKeys ?? [])];
}

function reviewValues(record: PersistedRepairReviewRecord): unknown[] {
  return [record.reviewId, record.accountId, record.conversationId, record.runId, record.goalId, record.stateId, record.reviewType, record.decision ?? null, record.resolutionStatus, JSON.stringify(record.reasonCodes), JSON.stringify(record.evidenceRefs), JSON.stringify(record.evidenceTypes), record.evidenceWindowStart ?? null, record.evidenceWindowEnd ?? null, record.reviewerSource, record.attempt, record.claimKey ?? null, record.leaseOwner ?? null, record.leaseExpiresAt ?? null, record.idempotencyKey, record.reviewedAt ?? null, record.nextReviewAt ?? null, record.nextAction ?? null, record.overrideBy ?? null, record.overrideRejected ?? false, record.expectedStateVersion, record.supersedesReviewId ?? null, record.deadLetteredAt ?? null, record.resolvedAt ?? null, record.closedAt ?? null];
}

async function selectReviewForUpdate(executor: PoolLike, reviewId: string): Promise<PersistedRepairReviewRecord | undefined> {
  const result = await executor.query('select * from auto_reply_review_records where review_id=$1 for update', [reviewId]);
  return result.rows[0] ? toReview(result.rows[0]) : undefined;
}

async function selectStateVersion(executor: PoolLike, accountId: string, conversationId: string): Promise<number | undefined> {
  const result = await executor.query('select state_version from auto_reply_conversation_state where account_id=$1 and conversation_id=$2 for update', [accountId, conversationId]);
  return result.rows[0] ? Number(result.rows[0].state_version ?? 0) : undefined;
}

async function updateReviewQuery(executor: PoolLike, record: PersistedRepairReviewRecord): Promise<boolean> {
  const result = await executor.query(`update auto_reply_review_records set
      decision=$2,resolution_status=$3,reason_codes=$4::jsonb,evidence_refs=$5::jsonb,evidence_types=$6::jsonb,
      evidence_window_start=$7,evidence_window_end=$8,reviewer_source=$9,attempt=$10,claim_key=$11,lease_owner=$12,
      lease_expires_at=$13,idempotency_key=$14,reviewed_at=$15,next_review_at=$16,next_action=$17,override_by=$18,
      override_rejected=$19,expected_state_version=$20,supersedes_review_id=$21,dead_lettered_at=$22,resolved_at=$23,
      closed_at=$24,updated_at=now() where review_id=$1 and expected_state_version=$25`, [
    record.reviewId, record.decision ?? null, record.resolutionStatus, JSON.stringify(record.reasonCodes), JSON.stringify(record.evidenceRefs), JSON.stringify(record.evidenceTypes), record.evidenceWindowStart ?? null, record.evidenceWindowEnd ?? null, record.reviewerSource, record.attempt, record.claimKey ?? null, record.leaseOwner ?? null, record.leaseExpiresAt ?? null, record.idempotencyKey, record.reviewedAt ?? null, record.nextReviewAt ?? null, record.nextAction ?? null, record.overrideBy ?? null, record.overrideRejected ?? false, record.expectedStateVersion, record.supersedesReviewId ?? null, record.deadLetteredAt ?? null, record.resolvedAt ?? null, record.closedAt ?? null, record.expectedStateVersion,
  ]);
  return (result.rowCount ?? 0) > 0;
}

function toState(row: Record<string, unknown>): ConversationState {
  return {
    stateId: String(row.state_id), accountId: String(row.account_id), conversationId: String(row.conversation_id), stateVersion: Number(row.state_version ?? 0), activeGoalId: optionalString(row.active_goal_id), goalStatus: String(row.goal_status) as ConversationState['goalStatus'], observedStage: optionalString(row.observed_stage), targetStage: optionalString(row.target_stage), emotionSnapshot: jsonRecord(row.emotion_snapshot), topicRelation: optionalString(row.topic_relation), pendingQuestions: jsonArray(row.pending_questions), clarificationRound: Number(row.clarification_round ?? 0), clarificationAttemptId: optionalString(row.clarification_attempt_id), lastQuestionFingerprint: optionalString(row.last_question_fingerprint), recommendationState: jsonRecord(row.recommendation_state), awaitingUser: Boolean(row.awaiting_user), awaitingUserSince: dateIso(row.awaiting_user_since), awaitingUserTtl: dateIso(row.awaiting_user_ttl), lastMessageId: optionalString(row.last_message_id), transitionAt: dateIso(row.transition_at) ?? new Date().toISOString(), policyVersion: optionalString(row.policy_version), lastSourceEventId: optionalString(row.last_source_event_id), lastSourceSequence: Number(row.last_source_sequence ?? 0), processedEventIds: jsonStringArray(row.processed_event_ids), processedIdempotencyKeys: jsonStringArray(row.processed_idempotency_keys),
  };
}

function toReview(row: Record<string, unknown>): PersistedRepairReviewRecord {
  return { reviewId: String(row.review_id), accountId: String(row.account_id), conversationId: String(row.conversation_id), runId: String(row.run_id), goalId: String(row.goal_id), stateId: String(row.state_id), reviewType: String(row.review_type) as PersistedRepairReviewRecord['reviewType'], decision: optionalString(row.decision), resolutionStatus: String(row.resolution_status), reasonCodes: jsonStringArray(row.reason_codes), evidenceRefs: jsonStringArray(row.evidence_refs), evidenceTypes: jsonStringArray(row.evidence_types), evidenceWindowStart: dateIso(row.evidence_window_start), evidenceWindowEnd: dateIso(row.evidence_window_end), reviewerSource: String(row.reviewer_source), attempt: Number(row.attempt ?? 0), claimKey: optionalString(row.claim_key), leaseOwner: optionalString(row.lease_owner), leaseExpiresAt: dateIso(row.lease_expires_at), idempotencyKey: String(row.idempotency_key), reviewedAt: dateIso(row.reviewed_at), nextReviewAt: dateIso(row.next_review_at), nextAction: optionalString(row.next_action), overrideBy: optionalString(row.override_by), overrideRejected: Boolean(row.override_rejected), expectedStateVersion: Number(row.expected_state_version ?? 0), supersedesReviewId: optionalString(row.supersedes_review_id), deadLetteredAt: dateIso(row.dead_lettered_at), resolvedAt: dateIso(row.resolved_at), closedAt: dateIso(row.closed_at) };
}

function toReviewEvent(row: Record<string, unknown>): PersistedRepairReviewEvent {
  return { eventId: String(row.event_id), reviewId: String(row.review_id), accountId: String(row.account_id), conversationId: String(row.conversation_id), eventType: String(row.event_type), sourceEventId: String(row.source_event_id), sourceSequence: Number(row.source_sequence ?? 0), stateVersion: Number(row.state_version ?? 0), policyVersion: String(row.policy_version), idempotencyKey: String(row.idempotency_key), occurredAt: dateIso(row.occurred_at) ?? new Date(0).toISOString(), payload: jsonRecord(row.payload) ?? {} };
}

function cloneState(state: ConversationState): ConversationState { return { ...state, pendingQuestions: state.pendingQuestions.map((item) => ({ ...item })), emotionSnapshot: state.emotionSnapshot ? { ...state.emotionSnapshot } : undefined, recommendationState: state.recommendationState ? { ...state.recommendationState } : undefined, processedEventIds: [...state.processedEventIds], processedIdempotencyKeys: [...state.processedIdempotencyKeys] }; }
function cloneReview(record: PersistedRepairReviewRecord): PersistedRepairReviewRecord { return { ...record, reasonCodes: [...record.reasonCodes], evidenceRefs: [...record.evidenceRefs], evidenceTypes: [...record.evidenceTypes] }; }
function reviewMemoryKey(record: PersistedRepairReviewRecord): string { return `${record.accountId}:${record.idempotencyKey}`; }
function replaceMemoryReview(store: Store, record: PersistedRepairReviewRecord): void {
  const reviews = memoryReviews.get(store) ?? new Map<string, PersistedRepairReviewRecord>();
  reviews.set(reviewMemoryKey(record), cloneReview(record));
  memoryReviews.set(store, reviews);
}
function hasEvent(store: Store, event: PersistedRepairReviewEvent): boolean {
  const keyValue = `${event.accountId}:${event.conversationId}:${event.idempotencyKey}`;
  return Boolean(memoryEvents.get(store)?.has(keyValue));
}
function optionalString(value: unknown): string | undefined { return value === undefined || value === null || String(value).trim() === '' ? undefined : String(value); }
function dateIso(value: unknown): string | undefined { if (value === undefined || value === null || value === '') return undefined; return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString(); }
function jsonRecord(value: unknown): Record<string, unknown> | undefined { if (!value) return undefined; if (typeof value === 'string') { try { return jsonRecord(JSON.parse(value)); } catch { return undefined; } } return typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : undefined; }
function jsonArray(value: unknown): Array<Record<string, unknown>> { if (!value) return []; if (typeof value === 'string') { try { return jsonArray(JSON.parse(value)); } catch { return []; } } return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)).map((item) => ({ ...item })) : []; }
function jsonStringArray(value: unknown): string[] { if (!value) return []; if (typeof value === 'string') { try { return jsonStringArray(JSON.parse(value)); } catch { return []; } } return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }
