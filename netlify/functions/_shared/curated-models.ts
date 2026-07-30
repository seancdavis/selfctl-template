// The curated list of models the admin-gated settings UI (and `/config/settings`)
// offers as the agent's default. `netlify-aig` — this template's only wired
// provider (see `db/schema.ts` / `_shared/deps.ts`) — is the Anthropic SDK
// under the hood, so only Claude ids are valid here; an OpenRouter/other
// provider id would fail at call time. Keep this a small, stable, valid
// subset of the AI Gateway's Anthropic models. `claude-haiku-4-5` doubles as
// the `config` table's column default (the fresh-deploy seed).
export const CURATED_MODELS = [
  "claude-haiku-4-5",
  "claude-sonnet-4-5",
  "claude-opus-4-5",
] as const;

export type CuratedModel = (typeof CURATED_MODELS)[number];
