# 2026-07-27 — Read-only UI: model picker

## Intent

Let the agent's owner change the **default model** from the read-only UI — completing config-as-data: the
model lives in the DB (B1), and now the owner can change it via the UI with no code or env editing (the
UI's allowed write boundary is secrets/config). Unit B3 of the MVP chain (the finisher); builds on B2 (#10).

## Scope

**In (`selfctl-template`):**
1. **Curated model list** — a small const of AIG **Claude** model ids (the `netlify-aig` provider IS the
   Anthropic SDK, so only Claude ids work). Use a stable, valid subset from the AI-Gateway Anthropic list,
   e.g. `["claude-haiku-4-5", "claude-sonnet-4-5", "claude-opus-4-5"]` (with `claude-haiku-4-5` the default).
   Put it somewhere both the endpoint and the UI can use (the endpoint returns it; the UI renders it).
2. **Admin-gated settings endpoint** — reuse the existing admin gate (READ `netlify/functions/config.ts` +
   `_shared/auth.ts` — the `/config/token` flow already gates on the admin key; use the same
   `requireAdmin`-style check). Add:
   - `GET /config/settings` (admin) → `{ provider, model, models: <curated list> }` (read the `config` row).
   - `POST /config/settings` (admin) `{ model: string }` → **validate `model` is in the curated list** (else
     400 — this is the `provider`/`model` validation B1 explicitly deferred here), then
     `UPDATE config SET model = ... WHERE id = 1`; return `{ provider, model }`. (Leave `provider` fixed at
     `netlify-aig` for now — no provider-switch UI; note that as future.)
   - You may add these as a new function file or extend the existing config function; keep the existing
     `/config/token` behavior intact.
3. **UI** (`public/index.html`) — after unlock (the admin key is already held in memory post-unlock), add a
   **Model** section: on unlock, `GET /config/settings` (with the admin-key bearer), render a `<select>` of
   the curated models with the current `model` selected, and a **Save** button that `POST`s
   `/config/settings { model }` and shows a status. Match the existing page's plain style + the in-memory
   admin-key handling (never persist the key). Show the section only after a successful unlock.

**Out:** per-thread model selection (the desktop app already does that via `POST /threads {model}`);
provider switching / an OpenRouter opt-in UI; any turn/chat/gate change.

## Plan
Read `config.ts` + `_shared/auth.ts` for the admin-gate + config-row-read pattern, and `public/index.html`
for the unlock flow + style. Then add the curated list, the two settings operations (validated), and the UI
section. The endpoint reads/writes the `config` row's `model` column (added in B1). Keep the change small
and consistent with the existing page.

## Done-signal
1. `npm run typecheck` — green.
2. The settings function (and any changed function) **bundles** for Netlify (esbuild dry-run).
3. `public/index.html` is valid (the Model section only renders after unlock; the fetch uses the admin-key
   bearer; POST validates + updates). No console-obvious errors in the static markup/script.
4. `git diff` confined to the settings function, `public/index.html`, and wherever the curated list lives.
   No agent-kit/app/schema changes (the `model` column already exists from B1).

**Orchestrator's live proof (post-publish):** unlock the UI → change the model in the picker → confirm the
`config` row's `model` updated → the next `POST /message` turn uses the new model (visible in the `llm.call`
event's `model`). (Preview needs 0.2.0 published — same as B1/B2.)

## Audit lenses
- **security** (primary here) — the settings endpoints MUST be admin-gated (same as `/config/token`), not
  client-token-gated (a connection-token holder must NOT change the model); the POST validates `model`
  against the curated list (no arbitrary value that could break the turn or inject); the admin key stays
  in-memory in the UI, never persisted.
- correctness — the config-row read/write is correct (single row `id=1`); the current model preselects; the
  save round-trips.
- simplicity — a thin endpoint + a small UI section; don't over-build.

## Issue
seancdavis/selfctl-template#11 — https://github.com/seancdavis/selfctl-template/issues/11

## Branch
`11-ui-model-picker` (off `9-chat-capability` / B2)

## Guardrails
- Loop bound: 3 audit/fix rounds.
- End by opening a **draft** PR to `main` (closes #11); never merge, never deploy.

## External dependencies
- The `config.model` column (B1) + agent-kit 0.2.0 (inherited via the branch). Live test needs 0.2.0
  published + a preview (orchestrator, post-publish).
