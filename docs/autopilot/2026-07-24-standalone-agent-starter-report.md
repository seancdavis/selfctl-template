# 2026-07-24 — Standalone agent starter — run report

Autopilot run for #1. Spec: [`2026-07-24-standalone-agent-starter.md`](./2026-07-24-standalone-agent-starter.md).

## Outcome

The repo is now a standalone, one-click Deploy-to-Netlify agent starter. All monorepo
couplings severed, LICENSE + README + DTN button added, two hardening fixes applied, and a
follow-up simplification of the `config` table. Typecheck green throughout; one clean
migration.

## Done-signal

| Check | Result |
|---|---|
| `npm install` + `package-lock.json` committed | ✅ (`npm ci --dry-run` clean) |
| `npm run typecheck` | ✅ |
| No monorepo couplings (`@selfctl`, `workspace:`, `tsconfig.base`, base-dir comment) | ✅ (remaining `../../` hits are legitimate same-repo relative imports + this spec's own prose) |
| One clean migration (events/proposals/notes/config single-row) | ✅ |
| `LICENSE` (MIT) + README DTN button | ✅ |
| Timing-safe token compare + race-safe `config` mint | ✅ |

## Audit (Codex, read-only, `--base main`)

- **Security** — no findings. Codex examined `auth.ts`, the config schema, and the
  admin-key / connection-token paths.
- **Simplicity (round 1)** — 1 Low, **confirmed + fixed:** `config` carried a redundant UUID
  PK plus a `singleton boolean UNIQUE` that didn't truly guarantee one row (one `true` + one
  `false` possible). Collapsed to `id integer PK default 1` + `CHECK (id = 1)` — a genuine
  single-row guarantee, no redundant columns; migration regenerated.
- **Simplicity (re-audit)** — 1 Low, **declined as a nit:** the insert passes `id: 1`
  explicitly though the schema defaults it. Left as-is — the explicit value self-documents the
  singleton insert at the call site; a marginal stylistic call, not a defect.

Loop stopped after round 1 (both lenses effectively clean).

## Notable dev judgment calls

- `tsconfig`: `moduleResolution: Bundler` / `module: ESNext` (not NodeNext) — matches how the
  functions actually ship (esbuild bundles them) and avoids rewriting every relative import
  with `.js` extensions.
- npm adopted (universal for a public template); `package-lock.json` committed.

## Not self-verified (Sean's smoke test)

The **live DTN deploy** — create the Netlify site from the repo and click Deploy to Netlify;
confirm the `AGENT_ADMIN_KEY` prompt, DB provisioning + migration on first deploy, then
unlock → connection token → protocol loop. Watch for the first-deploy DB-provisioning quirk
(DTN is prod-first on a fresh site).
