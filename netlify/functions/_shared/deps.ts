import type { AgentConfig } from "@selfctl/agent-kit";
import type { AgentContext } from "@selfctl/agent-kit/runtime";
import { buildRegistry } from "@selfctl/agent-kit/runtime";
import postgres, { type Sql } from "postgres";
import { AGENT_ID } from "./agent";
import { notesSkill } from "./skills/notes";
import { SYSTEM_PROMPT } from "./system";

/**
 * Builds the `AgentConfig` for this stateless HTTP binding from env.
 *
 * `host`/`port`/`token`/`databaseUrlRo`/`databaseUrlRw`/`modelShortlist`
 * belong to agent-kit's long-lived WS daemon (`startAgent`, in the package
 * root `.` entry) — this template never calls it. `runTurn` and the gate
 * functions (from `@selfctl/agent-kit/runtime`, which is all this binding
 * uses) never read those fields; they're filled in with harmless values only
 * because `AgentConfig` requires them.
 */
// Netlify exposes the DB connection string as NETLIFY_DB_URL (what
// @netlify/database + drizzle-orm/netlify-db read — this is why the Drizzle
// `db` client connects); some setups also surface NETLIFY_DATABASE_URL and its
// _UNPOOLED variant. Accept any, preferring an unpooled URL. postgres.js runs
// with `prepare:false`, so a pooled (pgBouncer) URL works too.
function netlifyDbUrl(): string | undefined {
  return (
    process.env.NETLIFY_DATABASE_URL_UNPOOLED ??
    process.env.NETLIFY_DATABASE_URL ??
    process.env.NETLIFY_DB_URL
  );
}

export function agentConfig(): AgentConfig {
  const databaseUrl = netlifyDbUrl() ?? "";
  const openrouterModel =
    process.env.OPENROUTER_MODEL ?? "anthropic/claude-3.5-haiku";

  return {
    agentId: AGENT_ID,
    host: "localhost",
    port: 0,
    token: "",
    databaseUrlRo: databaseUrl,
    databaseUrlRw: databaseUrl,
    modelShortlist: [{ id: openrouterModel, label: openrouterModel }],
    openrouterModel,
    costCapUsd: Number(process.env.AGENT_COST_CAP_USD ?? 0.5),
    retryCap: 2,
    // env `OPENROUTER_API_KEY` bypasses the Keychain lookup entirely (see
    // agent-kit's `resolveApiKey`), so this service name is never used.
    keychainService: "unused-stateless",
    timezone: process.env.AGENT_TIMEZONE ?? "UTC",
    perTurnInputCharCap: 8000,
    perTurnTokenCeiling: 20000,
  };
}

/**
 * A postgres.js client on the Netlify DB connection string — the wire format
 * agent-kit's gate speaks (tagged-template SQL against `pending_proposals`).
 * Prefers the unpooled URL; `prepare: false` is pgBouncer-safe. Callers must
 * `sql.end()` when done (Netlify Functions are short-lived; nothing else
 * closes this connection).
 */
export function agentSql(): Sql {
  const connectionString = netlifyDbUrl();
  if (!connectionString) {
    throw new Error(
      "agentSql: no Netlify DB connection string set (checked NETLIFY_DATABASE_URL_UNPOOLED, NETLIFY_DATABASE_URL, NETLIFY_DB_URL)",
    );
  }
  return postgres(connectionString, { prepare: false });
}

/**
 * Builds the stateless `AgentContext` a single request needs: config,
 * `dbs` (both `agentDb`/`gateDb` point at the same postgres.js client — this
 * template has no separate RO/RW roles), the skill registry, and the system
 * prompt.
 */
export function buildDeps(sql: Sql): AgentContext {
  return {
    config: agentConfig(),
    dbs: {
      agentDb: sql,
      gateDb: sql,
      close: () => sql.end(),
    },
    registry: buildRegistry([notesSkill]),
    systemPrompt: SYSTEM_PROMPT,
  };
}
