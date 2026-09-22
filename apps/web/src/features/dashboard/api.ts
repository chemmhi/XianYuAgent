import type { DashboardSnapshot } from '../../api/contracts';
import type { DashboardQuery } from './types';

export interface DashboardApiTransport {
  get<T>(path: string): Promise<T>;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  message?: string | null;
  error?: { code?: string };
}

function unwrap<T>(payload: T | ApiEnvelope<T>): T {
  if (payload && typeof payload === 'object' && 'success' in payload && 'data' in payload) {
    const envelope = payload as ApiEnvelope<T>;
    if (!envelope.success || envelope.data === null) throw new Error(envelope.message ?? envelope.error?.code ?? 'DASHBOARD_REQUEST_FAILED');
    return envelope.data;
  }
  return payload as T;
}

export interface DashboardApi {
  getSnapshot(query?: DashboardQuery): Promise<DashboardSnapshot>;
}

function toQueryString(query?: DashboardQuery): string {
  if (!query) return '';
  const params = new URLSearchParams({ range: query.range });
  if (query.range === 'custom' && query.from) params.set('from', query.from);
  if (query.range === 'custom' && query.to) params.set('to', query.to);
  return `?${params.toString()}`;
}

export function createDashboardApi(transport: DashboardApiTransport): DashboardApi {
  return {
    async getSnapshot(query) {
      return unwrap(await transport.get<DashboardSnapshot | ApiEnvelope<DashboardSnapshot>>(`/api/v1/dashboard/snapshot${toQueryString(query)}`));
    },
  };
}

