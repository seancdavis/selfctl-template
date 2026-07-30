# 2026-07-27 — Autopilot report: read-only UI model picker

Spec: [`2026-07-27-ui-model-picker.md`](./2026-07-27-ui-model-picker.md) · Issue #11 · Branch `11-ui-model-picker` (off B2 / #10)

## Outcome

Unit B3 (the finisher). The agent's owner can change the **default model** from the read-only UI —
completing config-as-data (model in the DB, changeable via the UI, no code/env). Converged in **1 audit
round, no fixes**. Draft PR — never merged/deployed.

## What changed
- **`_shared/curated-models.ts`** (new) — `CURATED_MODELS = ["claude-haiku-4-5","claude-sonnet-4-5","claude-opus-4-5"]`
  (Claude ids only — `netlify-aig` is the Anthropic SDK).
- **`settings.ts`** (new) — `GET /config/settings` (admin) → `{provider, model, models}`; `POST /config/settings {model}`
  (admin) → `z.enum(CURATED_MODELS)` validation → `UPDATE config SET model WHERE id=1` → `{provider, model}`.
  **`requireAdmin`-gated** (the same `AGENT_ADMIN_KEY` gate `/config/token` uses, NOT `requireClient`);
  `provider` is never writable.
- **`public/index.html`** — a Model section shown only after unlock; loads the current model + curated
  options via the admin-key bearer; Save round-trips through `POST /config/settings`. The admin key stays
  in memory (never persisted), matching the rest of the page.

## Audit — security (primary): NO findings
Confirmed: both operations `requireAdmin`-gated (a connection-token holder can't read/change settings);
`POST` validates `model` against the curated list (400 otherwise); `provider` is immutable; the UI holds the
admin key in memory only and gates the section behind unlock.

## Verification (static)
1. `npm run typecheck` — green.
2. All functions (incl. new `settings.ts`) bundle (esbuild dry-run).
3. `public/index.html` — Model section gated behind unlock, admin-key bearer, POST validates+updates.
4. `git diff` confined to `settings.ts`, `_shared/curated-models.ts`, `public/index.html`. No
   agent-kit/app/schema changes (the `model` column exists from B1).

## Orchestrator's live proof (post-publish)
Unlock the UI → change the model in the picker → confirm the `config` row's `model` updated → the next
`POST /message` uses the new model (visible in the `llm.call` event). (Needs 0.2.0 published + a preview.)

## Notes
- Completes the MVP chain: A (monorepo #20) → B1 (#8) → B2 (#10) → B3 (#11). All draft PRs.
