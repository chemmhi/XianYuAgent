import { writeFileSync } from 'node:fs';
import { AUTO_REPLY_PUBLIC_SURFACES, AUTO_REPLY_SEMANTIC_ASSERTIONS } from './auto-reply-semantic-assertions.catalog.ts';

const lines = [
  '# 自动回复 Agent 语义断言文档',
  '',
  '- 版本：AR-SEM-2026-09-26',
  '- 覆盖范围：入站消息、策略门控、工具型 Agent、生成、发送、接管并发、结果回读、可观测性与发布回滚。',
  `- 断言总数：${AUTO_REPLY_SEMANTIC_ASSERTIONS.length}`,
  '- 约定：`normal` 正常分支，`boundary` 边界分支，`error` 异常分支，`security` 安全分支，`idempotency` 幂等分支，`concurrency` 并发分支，`observability` 可观测性分支。',
  '',
  '## 公开实现面',
];

for (const surface of AUTO_REPLY_PUBLIC_SURFACES) {
  const symbols = surface.symbols.map((symbol) => '`' + symbol + '`').join('、');
  lines.push('- `' + surface.module + '`：' + symbols);
}

lines.push('', '## 断言清单', '', '| ID | 阶段 | 节点 | 分支 | 语义断言 | 可执行测试 |', '|---|---|---|---|---|---|');
for (const assertion of AUTO_REPLY_SEMANTIC_ASSERTIONS) {
  lines.push('| ' + assertion.id + ' | ' + assertion.stage + ' | ' + assertion.node + ' | ' + assertion.branch + ' | ' + assertion.statement + ' | `' + assertion.testName + '` |');
}

writeFileSync('docs/agent/auto-reply/semantic-assertions.md', lines.join('\n') + '\n', 'utf8');
console.log(JSON.stringify({ count: AUTO_REPLY_SEMANTIC_ASSERTIONS.length, surfaces: AUTO_REPLY_PUBLIC_SURFACES.length }));
