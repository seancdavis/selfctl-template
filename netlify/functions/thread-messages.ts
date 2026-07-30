import type { Config, Context } from "@netlify/functions";
import { getMessages } from "@selfctl/agent-kit/runtime";
import { db } from "../../db";
import { requireClient } from "./_shared/auth";
import { agentSql, buildDeps } from "./_shared/deps";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// GET /threads/:id/messages → the thread's messages in order. Reuses
// agent-kit's `getMessages` (@selfctl/agent-kit/runtime).
export default async (req: Request, context: Context): Promise<Response> => {
  const unauthorized = await requireClient(req, db);
  if (unauthorized) return unauthorized;

  const id = context.params.id;
  if (!id) {
    return jsonResponse({ error: "missing thread id" }, 400);
  }

  const sql = agentSql();
  try {
    const deps = await buildDeps(sql, db);
    const messages = await getMessages(id, deps);
    return jsonResponse(messages, 200);
  } finally {
    await sql.end();
  }
};

export const config: Config = {
  path: "/threads/:id/messages",
  method: "GET",
};
