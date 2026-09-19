import type { ReactNode } from 'react';
import type { ProductMutationError } from '../types';

export function ProductFormStateBoundary({ error, children }: { error: ProductMutationError | null; children: ReactNode }) {
  return <>
    {error && <div className={`product-form-state product-form-state-${error.code.toLowerCase()}`} role="alert"><strong>{error.code === 'VERSION_CONFLICT' ? '保存冲突' : '保存失败'}</strong><span>{error.message}</span>{error.code === 'VERSION_CONFLICT' && <><small>当前表单草稿已保留，请重新打开详情后再决定覆盖内容。</small>{error.conflict && <details><summary>查看服务端差异</summary><pre>{JSON.stringify({ server: error.conflict.server ? { title: error.conflict.server.title, description: error.conflict.server.description, categoryCode: error.conflict.server.categoryCode, priceMinor: error.conflict.server.priceMinor, configVersion: error.conflict.server.configVersion } : null, local: error.conflict.local }, null, 2)}</pre></details>}</>}</div>}
    {children}
  </>;
}
