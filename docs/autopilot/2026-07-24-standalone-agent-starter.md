# 2026-07-24 — Standalone, DTN-deployable agent starter

## Intent

This repo (`seancdavis/selfctl-template`) becomes a standalone, one-click **Deploy-to-Netlify**
agent starter: a minimal, protocol-conformant selfctl agent that anyone can fork and deploy.
The code was seeded raw from an internal monorepo (`main`'s root commit) and still carries
monorepo assumptions; this work makes it a self-contained, hardened, deployable template.

Only the *turn* is stubbed (no LLM) — the protocol, onboarding (`AGENT_ADMIN_KEY` → connection
token → read-only UI), Netlify DB, and auth are real. Do not add an LLM here; that lands later.

## Scope

**In:**
- Sever all monorepo couplings so the project stands alone at the repo root.
- `LICENSE` (MIT) + a real README with a working Deploy-to-Netlify button.
- Two hardening fixes: timing-safe token comparison; single-row + race-safe `config` table.
- npm tooling + committed `package-lock.json`.

**Out:**
- Any LLM / real turn logic (later phase).
- Any change to the monorepo it came from (that's a separate follow-up, different repo).
- Creating the Netlify site or deploying (Sean does that after merge).

## Plan

Work on branch `1-standalone-agent-starter`. The repo has no access to the source monorepo —
write every standalone replacement fresh; do not try to reference `../../` anything.

1. **`tsconfig.json`** — it currently does `"extends": "../../tsconfig.base.json"`, which does
   not exist here. Replace with a self-contained config appropriate for Netlify TypeScript
   functions (Web `Request`/`Response` + Node globals). Start from: `target`/`lib` ES2022,
   `module`/`moduleResolution` NodeNext, `strict` true, `skipLibCheck` true, `esModuleInterop`
   true, `noEmit` true, `types: ["node"]`, `include: ["netlify/functions/**/*", "db/**/*",
   "drizzle.config.ts"]`. **Adjust `lib`/`types` as needed so `npm run typecheck` passes** (add
   the DOM lib only if `Request`/`Response` don't resolve from `@types/node`).

2. **`package.json`** — rename `@selfctl/reference-agent` → `selfctl-agent-starter`; keep
   `private: true` (a template, never published); add a one-line `description`. Keep the pinned
   `drizzle-orm`/`drizzle-kit` `1.0.0-beta.22` versions, `@netlify/database`, `zod`,
   `@netlify/functions`, `@types/node`, `typescript`. Keep scripts `db:generate`
   (`drizzle-kit generate`), `db:migrate` (`netlify database migrations apply`), `typecheck`
   (`tsc --noEmit`).

3. **`netlify.toml`** — delete the two leading comment lines that mention a base directory of
   `agents/reference` (obsolete at the repo root). Keep `[build] publish = "public"`,
   `[build.environment] NODE_VERSION = "24"`, `[functions]`, and the `[template.environment]`
   `AGENT_ADMIN_KEY` block (that's what the DTN flow prompts for — leave it).

4. **`README.md`** — rewrite fully for the standalone template. Remove the `@selfctl/reference-agent`
   title, the `../../site/...` protocol link, and the `@selfctl/agent-kit` mentions. Include:
   - Title + one-paragraph "what this is" (a deployable, protocol-conformant selfctl agent
     starter; the turn is a stub today, the real agent core lands later).
   - A **Deploy to Netlify button**:
     `[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/seancdavis/selfctl-template)`
   - The deploy flow: click → set `AGENT_ADMIN_KEY` at the prompt → open the deployed site →
     unlock with the admin key → copy the connection token → drive the protocol loop.
   - The curl loop (message → events → decision → summary), noting `/config/token` uses the
     admin key and the protocol endpoints use the connection token.
   - A short "fork & customize" note. Reference the agent protocol by name (the public docs
     site isn't live yet — do NOT link a monorepo path).

5. **`LICENSE`** — MIT, `Copyright (c) 2026 Sean C Davis`.

6. **Hardening — timing-safe token comparison** (`netlify/functions/_shared/auth.ts`): add a
   helper `function safeEqual(a: string, b: string): boolean` using `timingSafeEqual` from
   `node:crypto` (guard: return false unless the byte lengths match, then `timingSafeEqual`).
   Use it for every bearer comparison in `requireAdmin` and `requireClient` (replace the `!==`
   / `===` token checks). Keep the `!expected` fail-closed behavior.

7. **Hardening — single-row + race-safe `config`** (`db/schema.ts` + `_shared/auth.ts`):
   - In `db/schema.ts`, make `config` single-row: add `singleton boolean not null default true`
     with a **unique** constraint, so at most one row can exist.
   - In `getOrCreateConnectionToken`, make the mint race-safe: insert with
     `.onConflictDoNothing()`, then re-select the row and return its token (so two concurrent
     first-mints converge on one row/token).
   - **Regenerate migrations clean:** delete both existing dirs under
     `netlify/database/migrations/`, then run `npm run db:generate` to produce ONE initial
     migration reflecting the full schema (`events`, `proposals`, `notes`, and `config` with
     the single-row unique constraint). Review the SQL. (Safe to regenerate — nothing has been
     deployed.)

8. **Adopt npm:** run `npm install` (generates `package-lock.json`); commit it.

## Done-signal

1. `npm install` succeeds; `package-lock.json` is committed.
2. `npm run typecheck` passes clean.
3. `rg -n --hidden -g '!node_modules' '@selfctl|workspace:|tsconfig\.base|\.\./\.\./|agents/reference'`
   returns **zero** hits (all monorepo couplings severed).
4. Exactly one migration directory under `netlify/database/migrations/`, whose SQL creates
   `events`, `proposals`, `notes`, and `config` — with a constraint enforcing a single `config` row.
5. `LICENSE` exists (MIT); `README.md` contains the Deploy-to-Netlify button linking to
   `https://app.netlify.com/start/deploy?repository=https://github.com/seancdavis/selfctl-template`.
6. `netlify/functions/_shared/auth.ts` uses `timingSafeEqual` for token comparison, and
   `getOrCreateConnectionToken` uses `onConflictDoNothing`.

The live DTN deploy is **not** part of the done-signal — Sean verifies that after merge.

## Audit lenses
- security — this is the public auth/onboarding surface (admin key, connection token, secrets boundary). Verify the timing-safe compare, fail-closed behavior, no token leakage, no injection in the read-only UI.
- simplicity

## Issue
#1 — https://github.com/seancdavis/selfctl-template/issues/1

## Branch
`1-standalone-agent-starter` (off `main`)

## Guardrails
- Loop bound: 3 audit/fix rounds.
- End by opening a **draft** PR to `main` (closes #1); never merge or deploy.

## External dependencies
None — all deps are public npm. (Netlify site creation + the live deploy are Sean's, post-merge.)
