# 2026-07-24 — Autopilot report: wire the real runTurn + gate into the agent

Spec: [`2026-07-24-real-turn-in-template.md`](./2026-07-24-real-turn-in-template.md) · Issue #3 · Branch `3-real-turn-in-template`

## Outcome

Unit 3 of the "real LLM core" chunk. The template's stubbed turn is replaced with the **real**
framework core: `POST /message` runs an LLM turn via `runTurn` from the published
`@selfctl/agent-kit@0.1.0` `/runtime` subpath, exposing a `reference.note` skill (a `createNote` tool
the model calls to create a gate proposal); `POST /proposals/:id/decision` routes to agent-kit's real
gate so approving runs the skill's `write()`. A deployed agent now **thinks**.

Converged in **2 audit/fix rounds** (bound was 3). Ends as a **draft PR** — never merged, never
deployed. Autopilot proved the **static** side; the live "it thinks" turn is Sean's smoke test.

## What changed

- Deps: `@selfctl/agent-kit@^0.1.0`, `@selfctl/protocol@^0.1.0`, `postgres@^3.4.9`.
- `_shared/deps.ts` — `agentConfig()` (AgentConfig from env; daemon-only fields filled with inert
  placeholders, documented), `agentSql()` (postgres.js on `NETLIFY_DATABASE_URL_UNPOOLED`,
  `prepare:false`), `buildDeps(sql)` → a stateless `AgentContext` (agentDb=gateDb=the postgres.js
  client).
- `_shared/skills/notes.ts` — the `reference.note` proposal kind (`write` inserts into `notes`) +
  a `createNote` tool. `_shared/system.ts` — the system prompt.
- `message.ts` — builds deps + a custom `ActivityLogger` (→ `events` log), calls `runTurn` (history
  `[]`), brackets `turn.started`/`proposal.created`/`turn.finished`, redacts secrets from any
  client-visible error. `decision.ts` — routes through agent-kit's gate, correct 409/500, emits
  `proposal.resolved`.
- Schema: `proposals` → `pending_proposals` + `feedback_note`/`parent_proposal_id`, `turn_id` dropped
  (the gate never populates it; events carry their own `turn_id`). One generated migration (a rename,
  data-preserving). `netlify.toml` — `OPENROUTER_API_KEY` added to `[template.environment]`.

## The two-driver DB bridge

agent-kit's gate speaks **postgres.js** tagged-templates against `pending_proposals`; the template
keeps **Drizzle over Netlify DB** for its own `events` log + reads. Both point at the same Neon
Postgres. Proposals inserted by the gate (postgres.js, autocommitted) are visible to the subsequent
Drizzle reads — verified sound by the audit.

## Audit history

Auditor: Codex (read-only), one lens per pass: **correctness** (primary), **security**, **simplicity**.

### Round 1 (commit `9735e03`)

- **decision.ts — blanket `409` for every gate error** (flagged by *both* correctness and security,
  High). Mis-categorized genuine failures (a `write()`/DB error → should be 500) *and* returned the
  raw `err.message` to the client (error oracle / secret-leak path). **Fixed:** re-read status after
  the catch → 409 only if now non-pending, else 500; generic client messages; `console.error` the
  detail server-side.
- **message.ts — raw `err.message` persisted in the client-readable `events` log** (security, High).
  A secret-leak path if an upstream lib echoes the DB URL/API key. **Fixed:** new `_shared/redact.ts`
  scrubs the known secret env values (guarded against unset/empty — no corruption footgun) before the
  error is stored; full detail to `console.error`.
- **Simplicity (3, all Low):** redundant override-`undefined` check (**fixed** — the kind-schema check
  subsumes it); `SYSTEM_PROMPT` sourced twice (**fixed** — use `deps.systemPrompt`); `dbs.close()` vs
  direct `sql.end()` double ownership (**declined** — a Low API-surface nit; the code closes exactly
  once and is correct).

**Deferred (not fixed) — correctness, Medium:** a proposal created mid-turn that then fails later
(cost/token ceiling) never gets its `proposal.created` event. Consequence is **benign** — a harmless,
un-approvable orphan `pending` row (nothing written, no crash). The clean fix belongs in **agent-kit
0.1.1** (let a stateless binding observe proposal creation / expose created ids on failure) rather than
template-side plumbing a 0.1.1 would obsolete. Tracked as a follow-up.

### Round 2 (commit `d7b685b`) — fixes + diff-focused re-audit

Applied the decision status/redaction fixes + the two simplicity cleanups. Diff-focused **security**
re-audit (`--base 9735e03`): **no findings** — generic client errors, server-side logging, correct
409/500, and `redactSecrets` correctly skips unset/empty values.

## Verification (done-signal — STATIC; live turn is Sean's)

1. `npm run typecheck` — green, against the real published `@selfctl/agent-kit@0.1.0` types.
2. Both functions **bundle** for Netlify (esbuild dry-run — `netlify build` needs a linked site
   unavailable headless): `message.ts` ~1.95 MB, `decision.ts` ~0.98 MB, no resolution errors.
3. `npm run db:generate` produced a valid migration: `RENAME proposals → pending_proposals`, `ADD
   feedback_note`, `ADD parent_proposal_id`, `DROP turn_id`. Not applied (needs a DB).
4. `git diff` confined to template files (functions, db, skill, system prompt, package.json/lock,
   netlify.toml, README, the migration). No `@selfctl/agent-kit` source touched.

## Sean's smoke test (the true proof — needs a real `OPENROUTER_API_KEY` + a Netlify DB)

`netlify dev` or deploy, then: unlock → connection token → `POST /message {"text":"remember the wifi
password is hunter2"}` → poll `GET /events?since=0`: `turn.started` → a **real** `proposal.created`
(the model called `createNote`) → `turn.finished` → `POST /proposals/:id/decision {"verb":"approve"}`
→ a row in `notes` + `proposal.resolved`.

## Follow-ups (agent-kit 0.1.1, monorepo — do NOT block this PR)

1. **Export the gate error classes** (`ProposalNotFoundError`, `ProposalNotPendingError`,
   `InvalidOverrideError`, `CostCapExceededError`, `TurnCeilingExceededError`) from `/runtime` — bindings
   currently can't `instanceof`-narrow, forcing the Drizzle pre-check + re-read dance in `decision.ts`.
2. **A proposal-creation hook for stateless bindings** (or created-ids-on-failure) — cleanly fixes the
   deferred orphan-`proposal.created` gap without template plumbing.
