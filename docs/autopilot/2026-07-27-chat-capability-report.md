# 2026-07-27 — Autopilot report: chat capability

Spec: [`2026-07-27-chat-capability.md`](./2026-07-27-chat-capability.md) · Issue #9 · Branch `9-chat-capability` (off B1 / #8)

## Outcome

Unit B2 of the MVP chain. The agent is now **conversational**: it persists threads + messages, emits the
chat events the desktop app fans out, serves the thread/model endpoints the app calls, and gives `runTurn`
the thread's history so it remembers the conversation — all by **reusing agent-kit 0.2.0's exported
`chatStore`** (no reimplementation). Plus the `/events` true-max-seq fix. After this, the app's full
type-in-the-app → conversation + proposal → approve loop works. Converged in **1 audit round + 1 fix**.
Draft PR — never merged/deployed.

## What changed

- **Chat schema + migration** — `chat_threads` + `chat_messages` mirroring agent-kit's chat DDL exactly
  (`last_read_at`, `model`, `proposal_ids uuid[]`, `components`/`cost` jsonb — the columns chatStore's raw SQL
  addresses). The developer confirmed the DDL against `node_modules/@selfctl/agent-kit/migrations/`.
- **5 endpoints** (thin: `requireClient` → `buildDeps` → `chatStore` fn → `appendEvent` → JSON):
  `GET/POST /threads` (one function, `method:["GET","POST"]`; POST emits `thread.created {thread}`),
  `GET /threads/:id/messages`, `POST /threads/:id/read` + `/rename` (emit `thread.updated {thread}`; since
  `markRead`/`setThreadTitle` return `void`, they re-read via `getThread`, 404 if null), `GET /models`
  (`{models: config.modelShortlist, defaultModelId: config.model}`).
- **`message.ts`** — `threadId` now required; `getMessages` → history (before the user append, no
  double-count) → `appendUserMessage` + `chat.appended` → `runTurn(history)` → `appendAssistantMessage`
  (`cost` = `ChatTurnCost`) + `chat.appended` → `thread.updated` → `turn.finished`. Assistant persisted only
  on success; `chat.error` (redacted) on failure.
- **`/events` fix** — `_shared/events.ts` `maxSeq()`; `events.ts` returns the true current max seq when idle
  (not `since`), sampling it BEFORE `readEvents` to avoid dropping an event inserted between the two queries.

## Audit — correctness: 1 finding, fixed
- **`/events` idle-cursor race (fixed, `e393d82`):** `readEvents` empty → `maxSeq` as a separate query could
  return a cursor past an event inserted in between, permanently skipping it. Fixed by sampling `maxSeq`
  BEFORE `readEvents` (the later read catches a between-query insert; a post-read insert is caught next poll).
- Everything else clean: the DDL matches agent-kit's; chatStore arg order + `sql.end()` correct; endpoint +
  event payload shapes match the protocol (`{thread}` / `{threadId, message}` / `{models, defaultModelId}`);
  message ordering + cost fields right; route method/param handling sound; typecheck passes.

## Verification (static)
1. `npm run typecheck` — green (against agent-kit 0.2.0 chatStore + protocol `ChatThread`/`ChatMessage`).
2. All new/changed functions bundle (esbuild dry-run).
3. `npm run db:generate` — a valid migration for the two chat tables matching agent-kit's DDL.
4. `git diff` confined to schema, the migration, the 5 new functions, `message.ts`, `_shared/events.ts`,
   `events.ts`. No agent-kit/app changes.

## Orchestrator's live proof (post-publish)
Once agent-kit 0.2.0 is published + a preview builds, drive the FULL loop from the desktop app (or curl):
`POST /threads` → `POST /message {threadId, text}` → `/events` shows the user `chat.appended`, a real
`createNote` `proposal.created`, the assistant `chat.appended`, `turn.finished` → approve. (Preview won't
build until 0.2.0 publishes — same as B1.)

## Notes
- Multi-turn memory IS included (the agent gets the thread history). Unit B3 adds the read-only-UI model
  picker (change the agent's default model via the UI).
