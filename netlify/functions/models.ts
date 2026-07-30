import type { Config } from "@netlify/functions";
import { db } from "../../db";
import { requireClient } from "./_shared/auth";
import { agentSql, buildDeps } from "./_shared/deps";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// GET /models → the model shortlist + default the app's picker offers. Both
// come from config-as-data (`config` table → `buildDeps` → AgentConfig).
export default async (req: Request): Promise<Response> => {
  const unauthorized = await requireClient(req, db);
  if (unauthorized) return unauthorized;

  const sql = agentSql();
  try {
    const deps = await buildDeps(sql, db);
    return jsonResponse(
      {
        models: deps.config.modelShortlist,
        defaultModelId: deps.config.model,
      },
      200,
    );
  } finally {
    await sql.end();
  }
};

export const config: Config = {
  path: "/models",
  method: "GET",
};
