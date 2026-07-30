# 2026-07-27 — AIG-native turn + config-as-data (model/provider in the DB)

## Intent

Make the deployed agent **think on Netlify AI Gateway with zero third-party accounts or keys** by
consuming `@selfctl/agent-kit@0.2.0` (the AIG/Anthropic provider seam), and move the **model + provider
into the agent's DB config** (seeded default, read per-turn) — not env, not hardcoded. Drop the OpenRouter
requirement. After this, a fresh DTN deploy thinks out-of-the-box (`netlify-aig` / `claude-haiku-4-5`).
Unit B1 of the MVP chain. Builds on getConnectionString (**supersedes PR #6** — don't merge #6 separately).

## Scope

**In (`selfctl-template`):**
1. **Bump the agent-kit dep to `^0.2.0`.** agent-kit 0.2.0 is NOT yet on npm, so install the provided
   local tarball for the build (see External dependencies); the committed `package.json` says `"@selfctl/agent-kit": "^0.2.0"`.
2. **Config-as-data — `provider` + `model` in the `config` table:**
   - Migration + Drizzle schema (`db/schema.ts`): add to `config` — `provider text NOT NULL DEFAULT 'netlify-aig'`
     and `model text NOT NULL DEFAULT 'claude-haiku-4-5'`. (The `config` table is the single-row `id=1` table
     that already holds `connection_token`; the column defaults ARE the seed.)
   - `deps.ts` `agentConfig()`: read `provider` + `model` from the config row (the single row is created
     lazily by `getOrCreateConnectionToken`; a defensive fallback to the same defaults if the row/columns
     are somehow absent). This makes `agentConfig()` (and `buildDeps`) **async** — thread the `await`
     through the two call sites (`message.ts`, `decision.ts`), which already have the DB client.
   - Set `AgentConfig.provider` from the row; rename the `openrouterModel` field to `model` (agent-kit 0.2.0
     renamed it) sourced from the row; set a minimal `modelShortlist` (e.g. `[{ id: model, label: model }]`
     — the real picker is B2). Keep the daemon-only placeholder fields as-is.
3. **`message.ts`:** stop constructing/ passing an OpenRouter client — drop `createOpenRouterClient(deps.config)`
   and the 4th `runTurn(...)` arg. `runTurn(input, logger, deps)` now resolves the provider internally from
   `deps.config.provider` (`netlify-aig` → the Anthropic/AIG provider, no keys). Remove any now-unused imports.
4. **`netlify.toml`:** remove `OPENROUTER_API_KEY` from `[template.environment]` — AIG needs no provider key,
   so the only DTN prompt is `AGENT_ADMIN_KEY`. (OpenRouter is an opt-in extension; leave a comment that a
   `provider='openrouter'` + key path is future, not wired here.)

**Out:** the read-only-UI **model picker** + the **chat capability** (threads/messages/`chat.appended`) +
the `/events` **true-max-seq** fix — all Unit B2. No `decision.ts` change (it runs the gate, no LLM). No
agent-kit change (that's shipped in 0.2.0). No app change.

## Plan

Follow Scope 1→4. Note the **async `agentConfig`/`buildDeps`** ripple (the DB read for provider+model) — the
one non-mechanical bit; `message.ts`/`decision.ts` must `await buildDeps(...)`. Verify against the installed
**agent-kit 0.2.0 types** (`node_modules/@selfctl/agent-kit`): `AgentConfig` now has `provider: "netlify-aig"|"openrouter"`
and `model` (not `openrouterModel`); `runTurn`'s 4th param is `providerOverride?: LlmProvider` (omit it).

## Done-signal

**Autopilot proves STATIC (the live AIG turn is the orchestrator's — see below):**
1. `npm run typecheck` — green against the installed agent-kit **0.2.0** types (confirms the `model`/`provider`
   rename + the dropped 4th arg + the async `buildDeps` all line up).
2. The functions **bundle** for Netlify (esbuild dry-run of `message.ts`/`decision.ts`, as in prior units).
3. `npm run db:generate` produces a valid migration adding the two `config` columns with the defaults.
4. `git diff` confined to the template's intended files (`db/schema.ts`, the migration, `deps.ts`, `message.ts`,
   `netlify.toml`, `package.json`/lock). No agent-kit/app changes.

**Orchestrator's LIVE proof (runnable now — AIG is auto-enabled on every Netlify plan, no keys):** deploy
the PR preview → `POST /message` → watch `/events` for a **real `createNote` proposal** produced by
`claude-haiku-4-5` via AIG → `turn.finished{ok}` → approve → note written. This is the first "agent thinks
with zero third-party accounts" proof — the milestone this whole arc is for.

## Audit lenses
- **correctness** (primary) — the config-as-data read (row created lazily; the seed defaults apply on a fresh
  deploy; the async ripple threads correctly); `provider` set to `netlify-aig` and `model` from the row;
  `runTurn` called WITHOUT an OpenRouter client (internal resolution); the migration adds the columns with
  defaults; no lingering OpenRouter-required code path.
- **security** — the config table stays admin-gated where it should; no secrets logged; dropping the
  OPENROUTER env doesn't leave a broken key-read path.
- simplicity — the async config read is clean, not over-threaded.

## Issue
seancdavis/selfctl-template#7 — https://github.com/seancdavis/selfctl-template/issues/7

## Branch
`7-aig-config-as-data` (off `use-getconnectionstring` — includes getConnectionString / supersedes #6)

## Guardrails
- Loop bound: 3 audit/fix rounds.
- End by opening a **draft** PR to `main` (closes #7; note it supersedes #6); never merge, never deploy.

## External dependencies
- **agent-kit 0.2.0 tarball** (0.2.0 isn't published yet): install
  `/private/tmp/claude-502/-Users-seancdavis-workspace-seancdavis-selfctl/024f24b8-1929-474b-95bb-66a97e3bd3e5/scratchpad/selfctl-agent-kit-0.2.0.tgz`
  for the local build (`npm install <tarball>`), but commit `package.json` referencing `^0.2.0` (resolves once
  Sean publishes). `@selfctl/protocol@^0.1.0` stays from npm.
- The live AIG turn needs a deployed preview (orchestrator runs it). No provider keys required (AIG auto-enabled).
