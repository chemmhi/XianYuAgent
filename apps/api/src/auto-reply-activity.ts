import type { AutoReplyRunListQuery, AutoReplyRunStage, AutoReplyRunStatus, Store } from './domain.js';
import { ServiceError } from './services.js';
import { projectAutoReplyRun } from './auto-reply-activity-projection.js';
import { AutoReplyRepairRepository, type PersistedRepairReviewRecord } from './auto-reply-repair-repository.js';
import type { AutoReplyRunEventRecord, AutoReplyRunListItem } from './domain.js';

const STATUSES: AutoReplyRunStatus[] = ['received', 'classified', 'context_loaded', 'generated', 'simulated', 'persisted', 'handoff', 'skipped', 'failed'];
const STAGES: AutoReplyRunStage[] = ['gateway_received', 'intent_recognition', 'context_read', 'reply_generation', 'sending', 'persisted', 'handoff', 'skipped', 'failed'];
const DECISIONS = ['replied', 'handoff', 'skipped', 'failed'] as const;

export class AutoReplyActivityService {
  private readonly repairRepository: AutoReplyRepairRepository;

  constructor(private readonly store: Store, repairRepository?: AutoReplyRepairRepository) {
    this.repairRepository = repairRepository ?? new AutoReplyRepairRepository(store);
  }

  async summary(input: { adminId: string; accountId?: string; from?: string; to?: string }) {
    const range = this.normalizeRange(input.from, input.to);
    await this.assertScope(input.adminId, input.accountId);
    return this.store.getAutoReplyActivitySummary(input.adminId, { accountId: input.accountId, ...range });
  }

  async list(input: { adminId: string; query: AutoReplyRunListQuery }) {
    const query = this.normalizeListQuery(input.query);
    await this.assertScope(input.adminId, query.accountId);
    const result = await this.store.listAutoReplyRuns(input.adminId, query);
    return { ...result, items: await this.enrichItems(result.items) };
  }

  async detail(input: { adminId: string; runId: string }) {
    if (!input.runId.trim()) throw new ServiceError(422, 'VALIDATION_FAILED', 'runId is required');
    const detail = await this.store.getAutoReplyRunDetail(input.adminId, input.runId);
    if (!detail) throw new ServiceError(404, 'NOT_FOUND', 'auto reply run not found');
    const [run] = await this.enrichItems([detail.run], new Map([[detail.run.id, detail.events]]));
    return { ...detail, run };
  }

  private async enrichItems(items: AutoReplyRunListItem[], existingEvents = new Map<string, AutoReplyRunEventRecord[]>): Promise<AutoReplyRunListItem[]> {
    if (items.length === 0) return items;
    const reviews = await this.repairRepository.listReviewsByRunIds(items.map((item) => item.id));
    const reviewsByRun = new Map<string, PersistedRepairReviewRecord[]>();
    for (const review of reviews) {
      const current = reviewsByRun.get(review.runId) ?? [];
      current.push(review);
      reviewsByRun.set(review.runId, current);
    }
    return Promise.all(items.map(async (item) => {
      const events = existingEvents.get(item.id) ?? await this.store.listAutoReplyRunEvents(item.adminId, item.id);
      const repairEvent = [...events].reverse().find((event) => event.eventType === 'repair.reviewed' || event.eventType === 'repair.shadow_reviewed');
      return { ...item, ...projectAutoReplyRun(item, { reviews: reviewsByRun.get(item.id) ?? [], shadowEventPayload: repairEvent?.payload }) };
    }));
  }

  private async assertScope(adminId: string, accountId?: string): Promise<void> {
    if (accountId && !(await this.store.hasAccountScope(adminId, accountId))) throw new ServiceError(403, 'FORBIDDEN', 'account scope required');
  }

  private normalizeListQuery(query: AutoReplyRunListQuery): AutoReplyRunListQuery {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    if (!Number.isInteger(page) || page < 1) throw new ServiceError(422, 'VALIDATION_FAILED', 'page must be a positive integer');
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new ServiceError(422, 'VALIDATION_FAILED', 'pageSize must be between 1 and 100');
    if (query.status && !STATUSES.includes(query.status)) throw new ServiceError(422, 'VALIDATION_FAILED', 'invalid auto reply run status');
    if (query.decision && !DECISIONS.includes(query.decision)) throw new ServiceError(422, 'VALIDATION_FAILED', 'invalid auto reply run decision');
    if (query.stage && !STAGES.includes(query.stage)) throw new ServiceError(422, 'VALIDATION_FAILED', 'invalid auto reply run stage');
    const range = this.normalizeRange(query.from, query.to);
    const keyword = query.keyword?.trim();
    if (keyword && keyword.length > 120) throw new ServiceError(422, 'VALIDATION_FAILED', 'keyword cannot exceed 120 characters');
    return { ...query, ...range, page, pageSize, keyword: keyword || undefined, accountId: query.accountId?.trim() || undefined, processing: query.processing === true };
  }

  private normalizeRange(from?: string, to?: string): { from: string; to: string } {
    const now = Date.now();
    const end = to ? Date.parse(to) : now;
    const start = from ? Date.parse(from) : end - 24 * 60 * 60 * 1000;
    if (!Number.isFinite(start) || !Number.isFinite(end)) throw new ServiceError(422, 'VALIDATION_FAILED', 'from/to must be valid ISO timestamps');
    if (start > end) throw new ServiceError(422, 'VALIDATION_FAILED', 'from must be before or equal to to');
    if (end - start > 31 * 24 * 60 * 60 * 1000) throw new ServiceError(422, 'VALIDATION_FAILED', 'date range cannot exceed 31 days');
    return { from: new Date(start).toISOString(), to: new Date(end).toISOString() };
  }
}
