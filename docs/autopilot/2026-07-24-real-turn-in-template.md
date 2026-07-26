# 2026-07-24 — Wire the real runTurn + gate into the template agent

## Intent

Replace the template's **stubbed** turn with the **real** framework core: `POST /message` runs an
actual LLM turn via `runTurn` from `@selfctl/agent-kit/runtime`, exposing a **notes** skill whose tool
the model calls to create a schema-validated proposal through the gate; `POST /proposals/:id/decision`
runs agent-kit's real gate so approving executes the skill's `write()`. After this, a deployed agent
**thinks** (message → LLM → proposal → approve → note written) instead of echoing text. This is Unit 3
of the "real LLM core" chunk — the last piece before an app-driven end-to-end test.

The protocol shape (cursored `events` log, turn lifecycle, envelopes) is already correct and stays; we
swap the *engine* behind it.

## Scope

**In (the `selfctl-template` repo):**
1. Add deps: `@selfctl/agent-kit` + `@selfctl/protocol` (0.1.0) and `postgres` (^3.4.9). See
   **Prerequisite** for how they're consumed (published vs. local tarball).
2. **DB bridge** — a `postgres.js` client on the Netlify DB connection string, since agent-kit's gate
   speaks postgres.js tagged-templates (Drizzle stays for the template's own `events`/reads).
3. **Schema migration** — rename `proposals` → `pending_proposals`, add `feedback_note text` and
   `parent_proposal_id uuid` (the columns the gate reads/writes). Update `db/schema.ts` + any Drizzle
   reader.
4. **A `reference.note` skill** — `defineProposalKind` (payload `{ text }`, `write` inserts into
   `notes`) + a `createNote` tool the model calls. Plus a minimal **system prompt**.
5. **Rewrite `netlify/functions/message.ts`** to build a stateless `AgentContext` + a custom
   `ActivityLogger` (→ `appendEvent`) and call `runTurn`, bracketing it with `turn.started` /
   `proposal.created` / `turn.finished` events.
6. **Rewrite `netlify/functions/decision.ts`** to call agent-kit's `approve`/`reject`/`override`
   (which run the skill's `write()`), then emit `proposal.resolved`.
7. Add `OPENROUTER_API_KEY` to `[template.environment]` in `netlify.toml` (DTN prompts for it).
8. Reconcile any other reader of the old `proposals` model (e.g. `summary.ts`) to `pending_proposals`.

**Out:**
- **Conversation memory / multi-turn history.** `runTurn` is called with `history: []` (single-turn)
  for now — the template has no messages table. Note it as a deferred enhancement; do NOT build a
  messages store in this unit.
- **The app, the Mac Mini relay, publishing** — separate steps.
- **No changes to `@selfctl/agent-kit` itself.** If a genuine gap in the published API surfaces, STOP
  and report it (it becomes a 0.1.1 in the monorepo) — do not vendor-patch agent-kit here.
- Auth (`requireClient`/`requireAdmin`), the `config`/connection-token model, `events`/`summary`
  transport shapes — unchanged except the `proposals`→`pending_proposals` reconcile.

## Prerequisite (Sean, before autopilot)

Unit 3 consumes `@selfctl/agent-kit@0.1.0` (with the `/runtime` subpath) + `@selfctl/protocol@0.1.0`,
which are built by monorepo PR #13. So first: **merge #13**, then either
- **(recommended) publish `0.1.0`** (protocol first, then agent-kit) — the template's `package.json`
  references the real versions, `npm install` + Netlify deploy just work; or
- **local tarballs** — `pnpm pack` both from monorepo `main`, install into the template as `file:`
  deps for the `netlify dev` proof, and commit the manifest referencing `^0.1.0` (won't install/deploy
  until published). More friction; use only if you'd rather not publish before Unit 3 runs.

The spec below assumes the published-package path; if tarballs, only the dep-install step differs.

## Plan

**Shared deps builder** — `netlify/functions/_shared/deps.ts`:
- `agentConfig()`: build an `AgentConfig` literal from env with sane defaults — `agentId: AGENT_ID`
  ("reference"), `openrouterModel: process.env.OPENROUTER_MODEL ?? "<a sensible default>"`,
  `costCapUsd: Number(process.env.AGENT_COST_CAP_USD ?? 0.5)`, `retryCap: 2`,
  `timezone: process.env.AGENT_TIMEZONE ?? "UTC"`, `perTurnInputCharCap: 8000`,
  `perTurnTokenCeiling: 20000`, `keychainService: "unused-stateless"` (env `OPENROUTER_API_KEY`
  bypasses the Keychain). Match `AgentConfig`'s exact field list from the published types.
- `agentSql()`: `postgres(process.env.NETLIFY_DATABASE_URL_UNPOOLED ?? process.env.NETLIFY_DATABASE_URL!, { prepare: false })`
  (`prepare:false` is pgBouncer-safe; prefer the unpooled URL). Returns the client.
- `buildDeps(sql)`: `{ config: agentConfig(), dbs: { agentDb: sql, gateDb: sql, close: () => sql.end() }, registry: buildRegistry([notesSkill]), systemPrompt: SYSTEM_PROMPT }` typed as `AgentContext`.

**The skill** — `netlify/functions/_shared/skills/notes.ts`:
- `defineProposalKind({ kind: "reference.note", schema: z.object({ text: z.string().min(1).max(4000) }), write: async (sql, p) => { await sql\`INSERT INTO notes (text) VALUES (${p.text})\`; } })`.
- A `createNote` tool (`tools(rt)`) whose `execute` validates then `rt.propose("reference.note", { text })`.
- `export const notesSkill: Skill = { name: "notes", proposals: [noteKind], tools }`. (Confirm the exact
  `Skill`/`defineProposalKind`/`SkillRuntime` shapes against the published `.` types.)

**System prompt** — `_shared/system.ts`: a short prompt — the agent saves notes on request; it must use
`createNote` to *propose* a note (nothing is saved without approval); don't claim to have saved
anything.

**`message.ts`:**
- Keep `requireClient` auth + `Body` parse.
- `const sql = agentSql(); try { const deps = buildDeps(sql); ... } finally { await sql.end(); }`.
- Build a custom `ActivityLogger`: `{ log: async (entry) => { await appendEvent(db, { agentId: AGENT_ID, turnId, type: entry.eventType, payload: entry.payload }); } }` (Drizzle `db` for events; capture `turnId` in closure).
- `const turnId = randomUUID(); await appendEvent(db, { …, type: "turn.started", … });`
- `const openrouter = createOpenRouterClient(deps.config);`
- `const result = await runTurn({ systemPrompt: SYSTEM_PROMPT, history: [], userInput: body.text }, logger, deps, openrouter);`
- For each `id` of `result.proposalIds`: read the row from `pending_proposals` (Drizzle or `sql`) and
  `appendEvent(… type: "proposal.created", payload: { proposal })`.
- `appendEvent(… type: "turn.finished", payload: { turnId, status: "ok" })`; return `{ turnId }`.
- Wrap the turn in try/catch: on `CostCapExceededError`/`TurnCeilingExceededError`/any error, emit
  `turn.finished { status: "error", error: message }` and return 200 `{ turnId }` (the error is in the
  event stream, per protocol) — or an appropriate status; keep it consistent with the stub's contract.

**`decision.ts`:**
- Keep `requireClient` + `DecisionBody` + the `:id` param.
- `const sql = agentSql(); try { const deps = buildDeps(sql);` then map verb →
  `approve(id, deps)` / `reject(id, deps)` (or `rejectWithFeedback(id, note, deps)` when `note` given) /
  `override(id, payload, deps)`. These return the resolved proposal and run the skill `write()` for
  approve/override inside the gate transaction. `finally { await sql.end(); }`.
- Translate agent-kit's not-found / not-pending errors to 404 / 409 (inspect what the gate throws;
  guard before calling if cleaner).
- `appendEvent(… type: "proposal.resolved", payload: { proposal: resolved })`; return the resolved proposal.

**Schema/migration:** update `db/schema.ts` — rename the `proposals` export to `pendingProposals`
(table `pending_proposals`), add `feedbackNote: text("feedback_note")` and
`parentProposalId: uuid("parent_proposal_id")`. Run `npm run db:generate` to emit the migration under
`netlify/database/migrations/`; verify the generated SQL renames the table (or drops+creates acceptably
for a template with no production data — a rename is cleaner) and adds the columns. Update type exports
and any importer of `proposals`.

## Done-signal

**Autopilot proves STATIC correctness (the live turn is Sean's — see below):**
1. `npm run typecheck` (`tsc --noEmit`) green in the template.
2. The functions **bundle** for Netlify: `npx netlify build` (or an esbuild dry-run of each function
   entry) succeeds — confirms `@selfctl/agent-kit/runtime`, `postgres`, and `drizzle` all bundle in the
   esbuild function build. (If `netlify build` needs a linked site/login unavailable headless, fall
   back to an esbuild bundle of `netlify/functions/message.ts` + `decision.ts` with `platform:node`,
   `bundle:true`, and report it.)
3. `npm run db:generate` produces a valid migration; the emitted SQL is well-formed and does the rename
   + two column adds. (Don't apply it — that needs a DB.)
4. Structural review passes: `message.ts` calls `runTurn(input, logger, deps, openrouter)` with a
   properly-built `AgentContext`; the custom `ActivityLogger` writes every entry to `events`;
   `decision.ts` routes through agent-kit's gate; the `notes` skill is registered via
   `buildRegistry([notesSkill])`; `pending_proposals` is the single proposal table.
5. `git diff` is confined to the template repo's intended files (functions, db, skill, system prompt,
   package.json, netlify.toml, the new migration). No `@selfctl/agent-kit` source edits.

**Sean's smoke test (live — autopilot can't run it; needs a real `OPENROUTER_API_KEY` + a Netlify DB):**
`netlify dev` (or a deploy), then: unlock → get the connection token → `POST /message {"text":"remember
that the wifi password is hunter2"}` → poll `GET /events?since=0` and watch `turn.started` → a REAL
`proposal.created` (the model called `createNote`) → `turn.finished` → `POST /proposals/:id/decision
{"verb":"approve"}` → a row appears in `notes` and a `proposal.resolved` event lands. This is the true
"the agent thinks" proof.

## Audit lenses
- **correctness** (primary) — is the stateless `AgentContext` built correctly (all `AgentConfig` fields;
  `agentDb`/`gateDb` = the postgres.js client); does the custom `ActivityLogger` land every activity in
  `events`; are `turn.started`/`proposal.created`/`turn.finished`/`proposal.resolved` all emitted (since
  agent-kit's own emits no-op statelessly); does `decision` route through the real gate; is the
  `pending_proposals` schema exactly what the gate expects; are errors surfaced as `turn.finished{error}`?
- **security** — the connection between the read-only claim and the gate: does `message`/`decision`
  keep auth; can the connection token still only reach these endpoints; is the OpenRouter key read from
  env (never logged/echoed)? Does the DB bridge open the client with least surprise (no creds leak into
  events)?
- simplicity — is the two-client (postgres.js + Drizzle) bridge as clean as it can be; is `buildDeps`
  shared, not duplicated across message/decision?

## Issue
seancdavis/selfctl-template#3 — https://github.com/seancdavis/selfctl-template/issues/3

## Branch
`3-real-turn-in-template` (in the `selfctl-template` repo)

## Guardrails
- Loop bound: 3 audit/fix rounds.
- End by opening a **draft** PR to the template's `main` (closes #3); never merge, never deploy.
- If the published-package API is genuinely missing something a stateless binding needs, STOP and
  report (it's a monorepo 0.1.1), don't patch agent-kit here.

## External dependencies
- `@selfctl/agent-kit@0.1.0` + `@selfctl/protocol@0.1.0` available (published, or local tarballs) — the
  Prerequisite above.
- Sean's live smoke test needs a real `OPENROUTER_API_KEY` and a Netlify DB — out of autopilot's reach.
