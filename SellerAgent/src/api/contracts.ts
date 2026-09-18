export type ApiMode = 'mock' | 'live';

export interface PageQuery {
  page?: number;
  pageSize?: number;
  search?: string;
}

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AccountSummary {
  id: string;
  displayName: string;
  remark: string;
  enabled: boolean;
  online: boolean;
  aiEnabled: boolean;
  credentialState: 'complete' | 'refresh_required' | 'missing';
}

export interface ProductSummary {
  accountId: string;
  itemId: string;
  title: string;
  price: number;
  stock: number;
  status: 'on_sale' | 'draft' | 'out_of_stock' | 'offline';
  updatedAt: string;
  cardBatchRef?: string;
}

export interface CouponBatchSummary {
  batchId: string;
  itemId?: string;
  itemTitle: string;
  total: number;
  available: number;
  status: 'available' | 'bound' | 'low_stock' | 'delivered' | 'revoked';
  createdAt: string;
  accountId: string;
}

export interface OrderSummary {
  orderNo: string;
  buyerId: string;
  buyerName: string;
  itemId: string;
  itemTitle: string;
  amount: number;
  paymentStatus: 'paid' | 'completed' | 'refunding' | 'closed';
  deliveryStatus: 'pending' | 'delivered' | 'failed' | 'not_delivered';
  createdAt: string;
  accountId: string;
}

export interface ConversationSummary {
  cid: string;
  accountId: string;
  buyerId: string;
  buyerName: string;
  itemTitle: string;
  preview: string;
  unreadCount: number;
  lastMessageAt: string;
}

export interface ChatMessage {
  messageId: string;
  cid: string;
  sender: 'buyer' | 'agent' | 'system';
  text: string;
  createdAt: string;
  source?: 'human' | 'ai' | 'system';
}

export interface DashboardSnapshot {
  todayOrderAmount: number;
  autoProcessRate: number;
  pendingManualCount: number;
  availableCouponCount: number;
  trend: Array<{ label: string; orderAmount: number; autoProcessRate: number }>;
  riskTodos: Array<{ id: string; title: string; severity: 'high' | 'medium' | 'low'; href: string }>;
}

export interface WorkspaceSession {
  id: string;
  title: string;
  preview: string;
  status: 'active' | 'waiting_confirmation' | 'completed' | 'failed';
  updatedAt: string;
}

export interface WorkspaceRunStep {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'waiting_confirmation';
  detail?: string;
}

export interface WorkspaceRun {
  id: string;
  sessionId: string;
  instruction: string;
  status: 'queued' | 'running' | 'waiting_confirmation' | 'succeeded' | 'failed' | 'cancelled';
  steps: WorkspaceRunStep[];
  auditRef?: string;
  idempotencyKey?: string;
}

export interface ConfirmationCard {
  id: string;
  runId: string;
  action: string;
  risk: 'low' | 'medium' | 'high';
  summary: string;
  changes: Array<{ label: string; before: string; after: string }>;
  policyRef: string;
  auditRef: string;
  idempotencyKey: string;
}

export interface AgentSettings {
  autoReplyEnabled: boolean;
  autoDeliveryEnabled: boolean;
  replyDelaySeconds: number;
  humanApprovalRequiredFor: string[];
  aiProvider: string;
  aiModel: string;
  systemSettings: Record<string, string | number | boolean>;
}
