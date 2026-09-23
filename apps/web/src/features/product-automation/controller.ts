import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createMockProductAutomationApi, type ProductAutomationApi } from './api';
import type { AutomationCoupon, AutomationRuleKey, ProductAutomationBatchUpdate, ProductAutomationConfig, ProductAutomationSavePhase, ProductAutomationUpdate } from './types';

export function toProductAutomationSaveError(error: unknown): string {
  const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status?: unknown }).status) : undefined;
  const payload = typeof error === 'object' && error && 'payload' in error ? (error as { payload?: unknown }).payload : undefined;
  const payloadError = payload && typeof payload === 'object' && !Array.isArray(payload) && 'error' in payload && (payload as { error?: unknown }).error && typeof (payload as { error?: unknown }).error === 'object'
    ? (payload as { error: { code?: unknown } }).error
    : undefined;
  const code = typeof payloadError?.code === 'string' ? payloadError.code : '';
  if (code === 'AUTOMATION_VERSION_CONFLICT') return '自动化配置已被其他操作更新，请关闭抽屉后重新打开再保存。';
  if (status === 409 || code === 'CONFLICT') return '所选卡券状态已发生变化，请重新选择可发货卡券后再保存。';
  if (status === 403 || code === 'FORBIDDEN') return '当前管理员没有保存商品自动化配置的权限。';
  if (status === 404 || code === 'NOT_FOUND') return '商品或自动化配置不存在，请刷新商品列表后重试。';
  if (status === 422 || code === 'VALIDATION_FAILED') return '自动化配置校验失败，请确认启用的发货/赠品规则已选择可发货卡券，且参数完整。';
  if (error instanceof TypeError) return '自动化配置服务暂时不可用，请检查连接后重试。';
  return error instanceof Error && error.message ? error.message : '自动化配置保存失败，请重试。';
}

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
      setError(toProductAutomationSaveError(cause));
      return null;
    }
  }, [api, productId]);

  const saveBatch = useCallback(async (input: ProductAutomationBatchUpdate) => {
    setSavePhase('saving');
    setError(null);
    try {
      if (!Object.values(input.apply).some(Boolean)) {
        setSavePhase('success');
        return { updatedCount: 0 };
      }
      const result = await api.saveBatch(input);
      setSavePhase('success');
      return result;
    } catch (cause) {
      setSavePhase('error');
      setError(toProductAutomationSaveError(cause));
      return null;
    }
  }, [api]);

  const selectedCoupon = useMemo(() => {
    const byId = new Map(coupons.map((coupon) => [coupon.id, coupon]));
    return (key: AutomationRuleKey) => (config?.[key].couponIds ?? []).map((id) => byId.get(id)).filter(Boolean) as AutomationCoupon[];
  }, [config, coupons]);

  return { config, setConfig, coupons, loadPhase, savePhase, error, load, save, saveBatch, selectedCoupon };
}
