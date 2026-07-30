# 2026-07-27 — Chat capability: threads + messages + chat.appended

## Intent

Make the agent **conversational** so the desktop app's chat works end-to-end: persist threads + messages,
emit the chat events the app fans out, add the thread/model endpoints it calls, and give `runTurn` the
thread's history so the agent remembers the conversation. Reuse agent-kit 0.2.0's exported `chatStore` (no
reimplementation). Plus the `/events` true-max-seq fix (unblocks the app's cursor reset-recovery). Unit B2
of the MVP chain; builds on B1 (#8).

## Scope

**In (`selfctl-template`):**
1. **Chat schema** — `db/schema.ts` + a migration mirroring agent-kit's chat DDL **exactly** (chatStore uses
   raw postgres.js SQL against these tables — column names/types are load-bearing). READ
   `node_modules/@selfctl/agent-kit/migrations/0003_chat.sql` + `0004_chat_model.sql` and mirror them:
   - `chat_threads`: `id uuid PK default gen_random_uuid()`, `agent_id text NOT NULL`, `title text`,
     `model text`, `created_at timestamptz NOT NULL default now()`, `last_message_at timestamptz NOT NULL default now()`,
     `last_read_at timestamptz NOT NULL default now()`, index `(agent_id, last_message_at desc)`.
   - `chat_messages`: `id uuid PK default gen_random_uuid()`, `thread_id uuid NOT NULL references chat_threads(id) on delete cascade`,
     `role text NOT NULL check (role in ('user','assistant'))`, `text text NOT NULL`, `ts timestamptz NOT NULL default now()`,
     `proposal_ids uuid[]`, `components jsonb`, `cost jsonb`, `retry_attempt integer`, index `(thread_id, ts)`.
   - Confirm the exact columns against the agent-kit migrations before writing (they're the source of truth).
2. **Reuse `chatStore`** — import from `@selfctl/agent-kit/runtime` (0.2.0 exports these as required-`deps`
   wrappers): `createThread`, `listThreads`, `getThread`, `getMessages`, `appendUserMessage`,
   `appendAssistantMessage`, `setThreadTitle`, `markRead`. They run against `deps.dbs.gateDb` (the postgres.js
   client `buildDeps` already provides). READ `node_modules/@selfctl/agent-kit/dist/runtime.d.ts` for the exact
   signatures (arg order, the `appendAssistantMessage` opts shape `{proposalIds, components?, cost?, retryAttempt?}`).
3. **Endpoints** (new functions under `netlify/functions/`, each: `requireClient` auth → `buildDeps` → call
   `chatStore` → `appendEvent` where noted → return JSON). Match the app's calls (`app/src/http/client.ts`):
   - `GET /threads` → `listThreads(AGENT_ID, deps)` → `ChatThread[]`.
   - `POST /threads {title, model}` → `createThread(AGENT_ID, title, model, deps)` → the `ChatThread`; **emit
     `thread.created {thread}`**.
   - `GET /threads/:id/messages` → `getMessages(id, deps)` → `ChatMessage[]`.
   - `POST /threads/:id/read {}` → `markRead(id, deps)` → the updated `ChatThread`; **emit `thread.updated {thread}`**.
   - `POST /threads/:id/rename {title}` → `setThreadTitle(id, title, deps)` → the `ChatThread`; **emit `thread.updated {thread}`**.
   - `GET /models` → `{ models: deps.config.modelShortlist, defaultModelId: deps.config.model }`.
4. **`message.ts` — persist + emit + conversation history:**
   - `Body` now requires `threadId: string` (uuid). (The app always sends one from `POST /threads`; a missing
     one → 400.)
   - **Before the user message:** `const priorHistory = (await getMessages(threadId, deps)).map(m => ({ role: m.role, content: m.text }))` — the LlmMessage-shaped conversation so far.
   - **Persist the user message:** `const userMsg = await appendUserMessage(threadId, body.text, deps)`; **emit
     `chat.appended { threadId, message: userMsg }`** (so the app shows the user's own line).
   - **Run the turn** with history: `runTurn({ systemPrompt: deps.systemPrompt, history: priorHistory, userInput: body.text }, logger, deps)`.
   - **Persist the assistant reply:** build a `cost` from `result.totalCostUsd`/`totalInputTokens`/`totalOutputTokens`
     (match the `ChatTurnCost` shape); `const assistantMsg = await appendAssistantMessage(threadId, result.finalText, { proposalIds: result.proposalIds, components: result.components, cost }, deps)`; **emit
     `chat.appended { threadId, message: assistantMsg }`**.
   - Keep the existing `turn.started` / per-proposal `proposal.created` / `turn.finished` events. After the appends,
     **emit `thread.updated { thread: await getThread(threadId, deps) }`** so the app's list refreshes.
   - **On turn error** (the existing catch): in addition to `turn.finished{status:error}`, **emit `chat.error { message }`** (redacted) so the app's `handleChatError` fires. Order the appends so a failure doesn't leave a half-persisted turn in a confusing state (persist the user message before the turn; the assistant message only on success).
5. **`/events` true-max-seq fix** — `netlify/functions/_shared/events.ts` + `events.ts`: when `readEvents`
   returns no rows, return the **true current max seq** (`SELECT max(seq) FROM events`, 0 if empty) as `cursor`,
   instead of echoing `since`. So after a redeploy/reset the server cursor goes backwards, tripping the app's
   reset-recovery.

**Out:** the read-only-UI **model picker** (Unit B3); `GET /summary/widgets` (the app 404-tolerates it → `[]`;
the notes agent produces no widgets); auth/gate changes; any agent-kit change.

## Plan
Confirm the chatStore signatures + the chat DDL from `node_modules/@selfctl/agent-kit` (migrations + `dist/runtime.d.ts`)
BEFORE coding. Follow Scope 1→5. The `_shared/` helpers (`appendEvent`, `buildDeps`, `requireClient`) exist; new
endpoints follow the existing function conventions (`export const config = { path, method }`, `context.params.id`
for the `:id` routes). Dedup is the app's job (it dedups `chat.appended` by id) — the server just emits truthfully.

## Done-signal
**Autopilot proves STATIC (the live chat test is the orchestrator's post-publish):**
1. `npm run typecheck` — green (against agent-kit 0.2.0's chatStore + the protocol `ChatThread`/`ChatMessage` shapes).
2. All new + changed functions **bundle** for Netlify (esbuild dry-run).
3. `npm run db:generate` produces a valid migration for `chat_threads` + `chat_messages` (paste the SQL; confirm it
   matches agent-kit's chat DDL).
4. `git diff` confined to the template's intended files (schema, migration, the new/changed functions,
   `_shared/events.ts`). No agent-kit/app changes.

**Orchestrator's live proof (post-publish):** once agent-kit 0.2.0 is published + a preview builds, drive the FULL
loop from the desktop app (or curl): `POST /threads` → `POST /message {threadId, text}` → `/events` shows the user
`chat.appended`, a real `createNote` `proposal.created`, the assistant `chat.appended`, `turn.finished` → approve.
(The preview won't build until 0.2.0 publishes — same as B1.)

## Audit lenses
- **correctness** (primary) — the chat DDL matches agent-kit's exactly (chatStore's raw SQL depends on it); the
  endpoints call chatStore with the right arg order + emit the right events with the right payload shapes
  (`{thread}` / `{threadId, message}`); message.ts's order (getMessages → appendUser → runTurn → appendAssistant)
  is right and doesn't double-count the current message in history; the cost mapping matches `ChatTurnCost`; the
  `/events` max-seq fix returns 0 on an empty log.
- **security** — endpoints stay `requireClient`-gated; no secrets in events; `chat.error` uses `redactSecrets`.
- simplicity — reuse chatStore, don't reimplement; the endpoints are thin.

## Issue
seancdavis/selfctl-template#9 — https://github.com/seancdavis/selfctl-template/issues/9

## Branch
`9-chat-capability` (off `7-aig-config-as-data` / B1)

## Guardrails
- Loop bound: 3 audit/fix rounds.
- End by opening a **draft** PR to `main` (closes #9); never merge, never deploy.

## External dependencies
- agent-kit 0.2.0 (already installed from the tarball in B1's branch — this branch inherits it). The live chat test
  needs 0.2.0 published + a preview (orchestrator, post-publish).
