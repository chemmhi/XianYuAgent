# S4-VS5A Online Chat Read + Realtime

Status: `PARTIALLY_VERIFIED`

## Scope

- Read-only conversation list and message timeline.
- Cursor-based WebSocket backfill, reconnect, event/message de-duplication.
- Session, Origin allowlist, account-scope, and conversation-ownership checks.
- PostgreSQL persistence, Redis cross-process delivery, and restart recovery.

## Verification commands

```text
npm run typecheck
npm test
npm run build
node apps/api/scripts/messages-smoke.mjs
npm --workspace apps/api run test:messages:infra
npm --workspace apps/web run test:e2e:chrome:messages
git diff --check
```

## Results — September 20, 2026

- `npm run typecheck`: passed for API and web.
- `npm test`: passed; API smoke suite passed and Web Vitest passed with 15 files / 50 tests.
- `npm run build`: passed for API and web.
- `messages-smoke.mjs`: passed history reads, cursor replay, incremental replay, connected event, pagination, WS 401/403/404 rejection, and scope checks.
- `test:messages:infra`: passed against isolated PostgreSQL and Redis containers; two API runtimes received the same event through Redis, Redis restart recovered delivery, and PostgreSQL restart recovered message read/write.
- `test:e2e:chrome:messages`: passed connected → forced WebSocket disconnect → reconnecting banner → cursor backfill → automatic reconnect → de-duplicated timeline.

## Real Xianyu credential readback

- Reused the existing PostgreSQL credentials and current logged-in session; no duplicate Cookie login was performed.
- Account `19cf…`: 3 real conversations returned; the first conversation read 4 historical messages, including text and image content.
- Account `6f0…`: 1 real conversation returned; the first conversation read 20 historical messages with `hasMore=true`, including inbound, outbound, and system messages.
- PostgreSQL duplicate check returned `duplicate_external_refs=0`.
- No real Xianyu message was sent during verification. The text composer and send route remain implemented, but send/attachments/recall acceptance belongs to `S4-VS5B`.

## Browser evidence

- `screenshots/messages-desktop-1440x900.png`
- `screenshots/messages-reconnecting-1440x900.png`
- `screenshots/messages-mobile-390x844.png`

The desktop screenshot captures the connected timeline, the reconnecting screenshot captures the visible disconnect banner, and the mobile screenshot captures the recovered two-message timeline at `390x844`.

## Remaining review boundary

- The verified acceptance boundary is conversation read and realtime recovery; sending, attachments, recall, handoff, and release remain outside the `S4-VS5A` gate.
- `S5-RISK-021` remains open until independent review confirms the evidence and production deployment topology.
- This evidence does not claim external Xianyu APP/account acceptance.

## Rollback

Disable the conversation WebSocket upgrade and keep the `messages.*` tables in place. The UI falls back to historical HTTP reads; no historical messages or event cursors are deleted.
