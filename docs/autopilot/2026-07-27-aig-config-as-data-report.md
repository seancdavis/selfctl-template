# 2026-07-27 — Autopilot report: AIG-native turn + config-as-data

Spec: [`2026-07-27-aig-config-as-data.md`](./2026-07-27-aig-config-as-data.md) · Issue #7 · Branch `7-aig-config-as-data` (supersedes PR #6)

## Outcome

Unit B1 of the MVP chain. The template now consumes `@selfctl/agent-kit@0.2.0` and **thinks on Netlify AI
Gateway with zero third-party accounts or keys** (`netlify-aig` / `claude-haiku-4-5`). Model + provider are
**config-as-data in the DB** (seeded via the `config` table's column defaults), not env or code. The
OpenRouter requirement is gone. Converged in **1 audit round, no fixes**. Draft PR — never merged/deployed.

## What changed

- **`package.json`** — `@selfctl/agent-kit` `^0.1.0` → `^0.2.0` (built against the local 0.2.0 tarball; the
  lockfile's resolved URL points at the tarball until 0.2.0 publishes, then self-corrects).
- **`db/schema.ts` + migration** — `config` gains `provider text NOT NULL DEFAULT 'netlify-aig'` and
  `model text NOT NULL DEFAULT 'claude-haiku-4-5'`. The column defaults ARE the seed; the migration
  backfills any pre-existing row.
- **`_shared/deps.ts`** — `agentConfig(db)` / `buildDeps(sql, db)` are now **async**, reading `provider`+`model`
  from the config row (`?? DEFAULT_PROVIDER`/`DEFAULT_MODEL` fallback). `AgentConfig.provider`+`model` set from
  the row; `modelShortlist=[{id:model,label:model}]`.
- **`message.ts`** — dropped `createOpenRouterClient` + the 4th `runTurn` arg; `runTurn(input, logger, deps)`
  resolves the provider internally from `deps.config.provider`. **`decision.ts`** — `await buildDeps(...)`
  (no LLM change).
- **`netlify.toml`** — removed `OPENROUTER_API_KEY` from `[template.environment]` (only `AGENT_ADMIN_KEY`
  remains); comment notes `provider='openrouter'`+key is a future opt-in.

## Audit — correctness: NO findings
Confirmed: both handlers `await requireClient` (creating the config row) then `await buildDeps`; the
admin-key path that skips row creation is safe via the `?? DEFAULT` fallback; the migration is well-formed
and backfills existing rows; `runTurn` with no 4th arg selects the AIG/Anthropic provider (bare
`new Anthropic()`), `claude-haiku-4-5` is a valid AIG model; no residual OpenRouter construction/key read;
`sql.end()` stays in `finally`. The free-text `provider` cast is unvalidated but the picker/validation is
explicitly Unit B2. Typecheck passes.

## Verification
1. `npm run typecheck` — green against the installed agent-kit **0.2.0** types.
2. esbuild dry-run bundles `message.ts` (~2.46 MB) + `decision.ts` (~1.48 MB) clean.
3. `npm run db:generate` → `ALTER TABLE "config" ADD COLUMN "provider" text DEFAULT 'netlify-aig' NOT NULL; ADD COLUMN "model" text DEFAULT 'claude-haiku-4-5' NOT NULL;`
4. `git diff` confined to the template's intended files (schema, migration, deps.ts, message.ts, decision.ts,
   netlify.toml, package.json/lock). No agent-kit/app changes.

## Orchestrator's LIVE AIG proof (run on the PR preview)
Deploy preview → `POST /message {"text":"save a note: the wifi password is hunter2"}` → poll `/events` for a
**real `createNote` proposal from `claude-haiku-4-5` via AIG** → `turn.finished{ok}` → approve → note written.
AIG is auto-enabled on every Netlify plan, no keys — this is the first "agent thinks with zero third-party
accounts" proof. (Result appended to the PR once the preview is live.)

## Notes / follow-ups
- **Supersedes template PR #6** (it's built on getConnectionString) — merge this, close #6.
- Depends on `@selfctl/agent-kit@0.2.0` being published (monorepo PR #20) before the committed `^0.2.0`
  resolves on a fresh clone / production deploy.
- Unit B2 adds the read-only-UI **model picker** (+ `provider` validation), the **chat capability**, and the
  `/events` **true-max-seq** fix.
