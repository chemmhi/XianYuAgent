# Verification recovery source isolation (2026-10-25)

## Contract and boundaries

`bc480a2` placed read recovery before IM recovery. A thrown browser/read exception ended the account task, preventing later independent read sources and IM recovery from running. This slice isolates those failures without changing browser challenge completion or transport behavior.

- `xianyu-verification-read-recovery.ts` continues after an individual source fails, logs only a registered API and a static error code, and reports collected failures using `XianyuReadRecoveryError` after processing the batch. Failed sources retain their risk. Unknown/write APIs still receive only the existing safe identity probe.
- A credential CAS rejection terminates the batch and account recovery. It represents a changed login/revocation generation, rather than one failed API, and must not let this task overwrite a newer login. Each later source also rechecks account/credential availability.
- `xianyu-im-service.ts` isolates exceptions from read preflight, native recovery and the final read recheck so IM can recover independently. It checks current account/credential availability before IM. Any read-phase exception keeps the overall task pending, even if IM succeeds; it cannot emit a misleading completed event.
- Existing credential and risk revision CAS remain authoritative. There are no schema, dependency, public API or frontend changes.

## Verification evidence

Before changing production code, three new MemoryStore regressions failed: the second read was never attempted, and browser/preflight failures left the IM refresh count at zero. After implementation, the tests additionally cover a server recheck exception, revocation/new login during read recovery, static diagnostic redaction, actual service IM credential persistence and retention of the failed read risk.

Executed from `apps/api` with `NATIVE_RECOVERY_TEST_DATABASE_URL` pointing to the task's isolated local `xianyu_native_recovery_test` database and `VERIFICATION_RECOVERY_TEST_REDIS_URL` pointing to a local test Redis:

```powershell
node --import tsx --test scripts/xianyu-verification-read-recovery.test.ts scripts/xianyu-verification-risk-recheck.test.ts
node --import tsx --test scripts/xianyu-verification-recovery.test.ts scripts/xianyu-verification-guard-entry.test.ts scripts/xianyu-im-credential.test.ts scripts/xianyu-im-native-recovery.test.ts scripts/xianyu-listener-startup.test.ts
node --import tsx --test scripts/xianyu-browser-im-recovery.test.ts
```

Results: 53/53 MemoryStore/PostgreSQL recovery and CAS tests, 42/42 recovery/credential/guard/Redis tests and 9/9 real Chrome/PostgreSQL IM recovery tests passed without skips. Repository-root `npm run build:api` and `git diff --check` passed.

The new source-isolation tests use controlled browser/platform boundaries, a real local HTTP transport and real PostgreSQL. They do not prove live Xianyu challenge acceptance. Browser handoff changes and production verification belong to the parent slice and require its independent review. No push or deployment was performed by this slice.
