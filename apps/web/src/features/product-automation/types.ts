export type AutomationRuleKey = 'delivery' | 'reprice' | 'gift' | 'review';

export interface AutomationCoupon {
  id: string;
  label: string;
  typeLabel: string;
  specSummary: string;
  quantitySummary: string;
  stockSummary: string;
  accountId?: string;
  apiManaged?: boolean;
}

export interface AutomationRuleState {
  enabled: boolean;
  couponIds?: string[];
  couponBatchIds?: string[];
  targetPriceMinor?: number;
  repriceMessage?: string;
  message?: string;
  mode?: 'fixed';
  autoConfirm?: boolean;
  maxAttempts?: number;
  retryBackoffSeconds?: number;
  firstDelayHours?: number;
  repeatIntervalHours?: number;
  maxReminders?: number;
  reviewInitialHours?: number;
  reviewRepeatHours?: number;
  reviewMaxCount?: number;
  reviewMessage?: string;
}

export interface ProductAutomationConfig {
  productId: string;
  accountId: string;
  version: number;
  delivery: AutomationRuleState;
  reprice: AutomationRuleState;
  gift: AutomationRuleState;
  review: AutomationRuleState;
  updatedAt?: string;
}

/** Canonical backend wire shape; UI keeps short tab keys internally. */
export interface ProductAutomationConfigWire {
  productId: string;
  accountId: string;
  configVersion: number;
  config?: {
    paidAutoDelivery: AutomationRuleState;
    unpaidAutoReprice: AutomationRuleState;
    reviewGift: AutomationRuleState;
    reviewReminder: AutomationRuleState;
  };
  paidAutoDelivery?: AutomationRuleState;
  unpaidAutoReprice?: AutomationRuleState;
  reviewGift?: AutomationRuleState;
  reviewReminder?: AutomationRuleState;
  updatedAt?: string;
}

export interface ProductAutomationUpdate {
  version?: number;
  delivery: AutomationRuleState;
  reprice: AutomationRuleState;
  gift: AutomationRuleState;
  review: AutomationRuleState;
}

export interface ProductAutomationUpdateWire {
  configVersion?: number;
  paidAutoDelivery?: AutomationRuleState;
  unpaidAutoReprice?: AutomationRuleState;
  reviewGift?: AutomationRuleState;
  reviewReminder?: AutomationRuleState;
}

export interface ProductAutomationBatchUpdate {
  productIds: string[];
  expectedConfigVersions?: Record<string, number>;
  apply: Record<AutomationRuleKey, boolean>;
  rules: Record<AutomationRuleKey, AutomationRuleState>;
}

export interface ProductAutomationBatchUpdateWire {
  productIds: string[];
  expectedConfigVersions: Record<string, number>;
  config: ProductAutomationUpdateWire;
}

export type ProductAutomationLoadPhase = 'idle' | 'loading' | 'success' | 'error';
export type ProductAutomationSavePhase = 'idle' | 'saving' | 'success' | 'error';
