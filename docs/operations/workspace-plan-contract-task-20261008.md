@'
# Workspace Plan Mode Contract-Driven Task Plan (2026-10-08)

## User-visible task
用“03 PPT Master”的网盘公开分享链接创建一个卡券，关联“AI 技术咨询，需求定制开发服务”商品，然后启用自动发货。

## Approved design
- Plan steps carry exact action, requiresFacts, producesFacts, confirmationPolicy, and argPredicateId.
- Tool contracts are the single source of truth for plan compilation and execution validation.
- Structured facts persist across confirmation continuation and are sufficient to prove goal completion.
- The goal is completed only when the final predicate is true:
  - public share URL exists;
  - coupon batch ID exists and remains active;
  - exact product title resolves to a product ID;
  - paid auto-delivery is enabled;
  - paid auto-delivery is bound to the newly-created coupon batch ID;
  - readback confirms the saved configuration.
- If the compiled plan ends while the predicate is false, re-plan from missing facts/actions at most twice; then emit terminal failure and stop.
- If a tool has no deterministic input/output contract, emit a contract error instead of allowing the model to guess.
- Confirmation continuation reuses the same plan, facts, product ID, share URL, and coupon batch ID.

## Validation
- Unit: contract registry, action mismatch, fact predicates, canonical parameter mapping, plan completion predicate, extra-call truncation, re-plan budget.
- API/PostgreSQL: two confirmation cycles, durable batch/product/config facts, restart recovery, readback.
- Codex in-app browser: exact instruction, real DOM snapshots, click each active confirmation card, two stable final reads, one final answer, no duplicate tool loop, persisted goal predicate satisfied.

## Review
- Independent plan reviewer: PASS
- Reviewer hard-blocks resolved by using the isolated codex/plan-mode-stop worktree and preserving unrelated main-worktree changes.
