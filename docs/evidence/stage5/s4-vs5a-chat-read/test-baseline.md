# S4-VS5A Online Chat Read + Realtime

Status: `PARTIALLY_VERIFIED`

## Scope

- Read-only conversation list and message timeline.
- Search by buyer, buyer ID, item title, or last message; all/unread filters; independent left-column scroll; whole-row conversation selection.
- Buyer avatar, buyer nickname, item title, and item thumbnail metadata persisted through `016_conversation_media.sql`.
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
- `npm test`: passed; API smoke suite passed and Web Vitest passed with 15 files / 51 tests.
- `npm run build`: passed for API and web.
- `messages-smoke.mjs`: passed history reads, cursor replay, incremental replay, connected event, pagination, WS 401/403/404 rejection, and scope checks.
- `test:messages:infra`: passed against isolated PostgreSQL and Redis containers; two API runtimes received the same event through Redis, Redis restart recovered delivery, and PostgreSQL restart recovered message read/write.
- `test:e2e:chrome:messages`: passed connected → forced WebSocket disconnect → reconnecting banner → cursor backfill → automatic reconnect → de-duplicated timeline.
- `npm --workspace apps/api run migrate`: applied `016_conversation_media.sql`; PostgreSQL now exposes `buyer_avatar_url` and `item_image_url` on `messages.conversations`.
- Chrome/CDP interaction checks: search by item and buyer, unread filter, avatar/item thumbnail rendering, independent `overflow-y:auto` regions, whole-row selection, and no account selector on `/messages`.

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

The desktop screenshot captures the connected timeline with two sessions, avatars, item thumbnails, search, unread filter, and selected-session header; the reconnecting screenshot captures the visible disconnect banner; the mobile screenshot captures the responsive sidebar and independent conversation scroll at `390x844`. The mobile evidence is intentionally captured at the top of the page, so the timeline is below the first viewport; mobile interaction coverage is asserted by the Chrome/CDP flow rather than by a second screenshot.

## Composer interaction evidence

- The current `/messages` composer follows the product-specific interaction contract: centered bottom input, exact placeholder, Enter-to-send / Shift+Enter newline, bounded auto-grow, attachment strip with top-right removal, `+` attachment menu, Xianyu official image emoji picker, and a single bottom-right `发送` action.
- Empty text and no attachment keep `发送` disabled; an attachment alone enables it. Successful sends clear the corresponding draft/attachment; failed sends keep the unsent input visible and expose the controller error state.
- `npm --workspace apps/web run test` passed with 18 files / 58 tests, including composer-model and Xianyu emoji rendering regressions.
- `npm run test:e2e:chrome:messages` passed with CDP assertions for placeholder, disabled/enabled send states, attachment menu, emoji insertion, image preview/removal, reconnect, cursor backfill, and de-duplicated timeline. The E2E uses isolated fixture data; it does not send a real Xianyu message.

## Remaining review boundary

- The verified acceptance boundary is conversation read and realtime recovery plus local composer interaction behavior. Real external Xianyu send/attachment/recall acceptance, handoff, and release remain outside the `S4-VS5A` gate and require a separate controlled write review.
- `S5-RISK-021` remains open until independent review confirms the evidence and production deployment topology.
- External buyer identity enrichment is best-effort and short-timeout; if the MTOP profile query is unavailable, the session still renders from persisted nickname/ID/item metadata with a placeholder avatar.
- This evidence does not claim external Xianyu APP/account acceptance.

## Rollback

Disable the conversation WebSocket upgrade and keep the `messages.*` tables in place. The UI falls back to historical HTTP reads; no historical messages or event cursors are deleted.
