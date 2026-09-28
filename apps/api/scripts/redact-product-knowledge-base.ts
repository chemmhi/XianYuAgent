import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { ProductRecord } from '../src/domain.js';
import { decideProductKnowledgeBaseRedaction } from '../src/product-knowledge-base-redaction.js';

const explicitAdminId = process.argv.find((argument) => argument.startsWith('--admin-id='))?.slice('--admin-id='.length).trim();
const dryRun = process.argv.includes('--dry-run');
const runtime = createApp(loadConfig());

const summary = {
  dryRun,
  processed: 0,
  changed: 0,
  skipped: 0,
  removedChars: 0,
  failed: 0,
  failures: [] as Array<{ adminId: string; productId: string; code: string; message: string }>,
};

try {
  const adminIds = explicitAdminId ? [explicitAdminId] : await runtime.store.listAdminIds();
  for (const adminId of adminIds) {
    const firstPage = await runtime.products.list(adminId, { page: 1, pageSize: 100, sortBy: 'createdAt', sortOrder: 'asc' });
    for (const product of firstPage.items) await redactProduct(adminId, product);
    for (let page = 2; page <= firstPage.totalPages; page += 1) {
      const nextPage = await runtime.products.list(adminId, { page, pageSize: 100, sortBy: 'createdAt', sortOrder: 'asc' });
      for (const product of nextPage.items) await redactProduct(adminId, product);
    }
  }
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed > 0) process.exitCode = 1;
} finally {
  await runtime.close();
}

async function redactProduct(adminId: string, product: ProductRecord): Promise<void> {
  summary.processed += 1;
  const decision = decideProductKnowledgeBaseRedaction(product);
  if (!decision.changed) {
    summary.skipped += 1;
    return;
  }
  summary.removedChars += decision.removedChars;
  if (dryRun) {
    summary.changed += 1;
    return;
  }
  try {
    await runtime.products.update({
      adminId,
      productId: product.id,
      accountId: product.accountId,
      expectedConfigVersion: product.configVersion,
      patch: { knowledgeBase: decision.sanitized || null },
      requestId: `knowledge-base-redact:${product.id}`,
      traceId: `knowledge-base-redact:${product.id}`,
    });
    summary.changed += 1;
  } catch (error) {
    summary.failed += 1;
    summary.failures.push({ adminId, productId: product.id, code: error instanceof Error ? error.name : 'UNKNOWN_ERROR', message: error instanceof Error ? error.message : String(error) });
  }
}
