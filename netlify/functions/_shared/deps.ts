import { getConnectionString } from "@netlify/database";
import type { AgentConfig } from "@selfctl/agent-kit";
import type { AgentContext } from "@selfctl/agent-kit/runtime";
import { buildRegistry } from "@selfctl/agent-kit/runtime";
import postgres, { type Sql } from "postgres";
import type { db as dbClient } from "../../../db/index";
import { config as configTable } from "../../../db/schema";
import { AGENT_ID } from "./agent";
import { notesSkill } from "./skills/notes";
import { SYSTEM_PROMPT } from "./system";

// Typed against the shape of the drizzle client without importing it as a
// runtime value — callers (message.ts/decision.ts) pass their own `db`
// instance in.
type Db = typeof dbClient;

// Mirrors the `config` table's column defaults (see the migration adding
// `provider`/`model`) — used only if the config row or its columns are
// somehow absent, since the row is otherwise created lazily and race-safely
// by `getOrCreateConnectionToken` before any caller reaches here.
const DEFAULT_PROVIDER = "netlify-aig";
const DEFAULT_MODEL = "claude-haiku-4-5";

/**
 * Builds the `AgentConfig` for this stateless HTTP binding. `provider` and
 * `model` are config-as-data: read from the single-row `config` table (see
 * `db/schema.ts`), not env or a hardcoded constant, so an operator can change
 * what the agent thinks with without a redeploy. A fresh deploy's column
 * defaults ARE the seed — `netlify-aig` / `claude-haiku-4-5` — so the agent
 * thinks on Netlify AI Gateway out-of-the-box with zero third-party keys.
 *
 * `host`/`port`/`token`/`databaseUrlRo`/`databaseUrlRw`/`modelShortlist`
 * belong to agent-kit's long-lived WS daemon (`startAgent`, in the package
 * root `.` entry) — this template never calls it. `runTurn` and the gate
 * functions (from `@selfctl/agent-kit/runtime`, which is all this binding
 * uses) never read those fields; they're filled in with harmless values only
 * because `AgentConfig` requires them.
 */
export async function agentConfig(db: Db): Promise<AgentConfig> {
  const databaseUrl = getConnectionString();

  const [row] = await db.select().from(configTable).limit(1);
  const provider = row?.provider ?? DEFAULT_PROVIDER;
  const model = row?.model ?? DEFAULT_MODEL;

  return {
    agentId: AGENT_ID,
    host: "localhost",
    port: 0,
    token: "",
    databaseUrlRo: databaseUrl,
    databaseUrlRw: databaseUrl,
    modelShortlist: [{ id: model, label: model }],
    provider: provider as AgentConfig["provider"],
    model,
    costCapUsd: Number(process.env.AGENT_COST_CAP_USD ?? 0.5),
    retryCap: 2,
    // `netlify-aig` needs no key at all; an `openrouter` provider row would
    // still bypass the Keychain lookup via env (see agent-kit's
    // `resolveApiKey`), so this service name is never used either way.
    keychainService: "unused-stateless",
    timezone: process.env.AGENT_TIMEZONE ?? "UTC",
    perTurnInputCharCap: 8000,
    perTurnTokenCeiling: 20000,
  };
}

/**
 * A postgres.js client on the Netlify DB connection string — the wire format
 * agent-kit's gate speaks (tagged-template SQL against `pending_proposals`).
 * `@netlify/database`'s `getConnectionString()` resolves the right URL for the
 * current environment (the prod DB, or a deploy preview's isolated branch) — no
 * env-var names to hardcode. `prepare:false` keeps it pgBouncer-safe. Callers
 * must `sql.end()` when done (Netlify Functions are short-lived).
 */
export function agentSql(): Sql {
  return postgres(getConnectionString(), { prepare: false });
}

/**
 * Builds the stateless `AgentContext` a single request needs: config,
 * `dbs` (both `agentDb`/`gateDb` point at the same postgres.js client — this
 * template has no separate RO/RW roles), the skill registry, and the system
 * prompt. Async because `agentConfig` reads `provider`/`model` from the
 * `config` table.
 */
export async function buildDeps(sql: Sql, db: Db): Promise<AgentContext> {
  return {
    config: await agentConfig(db),
    dbs: {
      agentDb: sql,
      gateDb: sql,
      close: () => sql.end(),
    },
    registry: buildRegistry([notesSkill]),
    systemPrompt: SYSTEM_PROMPT,
  };
}
