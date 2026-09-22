import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createMockProductAutomationApi, type ProductAutomationApi } from './api';
import type { AutomationCoupon, AutomationRuleKey, ProductAutomationBatchUpdate, ProductAutomationConfig, ProductAutomationSavePhase, ProductAutomationUpdate } from './types';

const defaultApi = createMockProductAutomationApi();

export function useProductAutomationController(options: { api?: ProductAutomationApi; accountId?: string; productId?: string } = {}) {
  const api = options.api ?? defaultApi;
  const [config, setConfig] = useState<ProductAutomationConfig | null>(null);
  const [coupons, setCoupons] = useState<AutomationCoupon[]>([]);
  const [loadPhase, setLoadPhase] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [savePhase, setSavePhase] = useState<ProductAutomationSavePhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const productId = options.productId;
  const accountId = options.accountId;

  const load = useCallback(async (nextProductId = productId, nextAccountId = accountId) => {
    if (!nextProductId) return;
    const requestId = ++requestRef.current;
    setLoadPhase('loading');
    setError(null);
    try {
      const [nextConfig, nextCoupons] = await Promise.all([
        api.getConfig(nextProductId),
        api.listCoupons(nextAccountId ?? 'account-001'),
      ]);
      if (requestId !== requestRef.current) return;
      setConfig(nextConfig);
      setCoupons(nextCoupons);
      setLoadPhase('success');
    } catch (cause) {
      if (requestId !== requestRef.current) return;
      setLoadPhase('error');
      setError(cause instanceof Error ? cause.message : '自动化配置加载失败');
    }
  }, [accountId, api, productId]);

  useEffect(() => { if (productId) void load(productId, accountId); else { setConfig(null); setCoupons([]); setLoadPhase('idle'); } }, [accountId, load, productId]);

  const save = useCallback(async (input: ProductAutomationUpdate) => {
    if (!productId) return null;
    setSavePhase('saving');
    setError(null);
    try {
      const next = await api.saveConfig(productId, input);
      setConfig(next);
      setSavePhase('success');
      return next;
    } catch (cause) {
      setSavePhase('error');
      setError(cause instanceof Error ? cause.message : '自动化配置保存失败');
      return null;
    }
  }, [api, productId]);

  const saveBatch = useCallback(async (input: ProductAutomationBatchUpdate) => {
    setSavePhase('saving');
    setError(null);
    try {
      const result = await api.saveBatch(input);
      setSavePhase('success');
      return result;
    } catch (cause) {
      setSavePhase('error');
      setError(cause instanceof Error ? cause.message : '批量自动化配置保存失败');
      return null;
    }
  }, [api]);

  const selectedCoupon = useMemo(() => {
    const byId = new Map(coupons.map((coupon) => [coupon.id, coupon]));
    return (key: AutomationRuleKey) => (config?.[key].couponIds ?? []).map((id) => byId.get(id)).filter(Boolean) as AutomationCoupon[];
  }, [config, coupons]);

  return { config, setConfig, coupons, loadPhase, savePhase, error, load, save, saveBatch, selectedCoupon };
}

