import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const explicitAdminId = process.argv.find((argument) => argument.startsWith('--admin-id='))?.slice('--admin-id='.length).trim();
const runtime = createApp(loadConfig());
const summary = { processed: 0, changed: 0, skipped: 0, failed: 0, failures: [] as Array<{ adminId: string; productId: string; code: string; message: string }> };

try {
  const adminIds = explicitAdminId ? [explicitAdminId] : await runtime.store.listAdminIds();
  for (const adminId of adminIds) {
    const firstPage = await runtime.products.list(adminId, { page: 1, pageSize: 100, sortBy: 'createdAt', sortOrder: 'asc' });
    for (const product of firstPage.items) await initializeProduct(adminId, product);
    for (let page = 2; page <= firstPage.totalPages; page += 1) {
      const nextPage = await runtime.products.list(adminId, { page, pageSize: 100, sortBy: 'createdAt', sortOrder: 'asc' });
      for (const product of nextPage.items) await initializeProduct(adminId, product);
    }
  }
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed > 0) process.exitCode = 1;
} finally {
  await runtime.close();
}

async function initializeProduct(adminId: string, product: { id: string; accountId: string; configVersion: number }): Promise<void> {
  summary.processed += 1;
  try {
    const result = await runtime.productKnowledgeBase.appendFromConversations({ adminId, productId: product.id, accountId: product.accountId, expectedConfigVersion: product.configVersion, requestId: `knowledge-base-init:${product.id}`, traceId: `knowledge-base-init:${product.id}` });
    if (result.changed) summary.changed += 1;
    else summary.skipped += 1;
  } catch (error) {
    summary.failed += 1;
    summary.failures.push({ adminId, productId: product.id, code: error instanceof Error ? error.name : 'UNKNOWN_ERROR', message: error instanceof Error ? error.message : String(error) });
  }
}
