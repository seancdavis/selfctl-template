import type { Config, Context } from "@netlify/functions";
import { getThread, markRead } from "@selfctl/agent-kit/runtime";
import { db } from "../../db";
import { AGENT_ID } from "./_shared/agent";
import { requireClient } from "./_shared/auth";
import { agentSql, buildDeps } from "./_shared/deps";
import { appendEvent } from "./_shared/events";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// POST /threads/:id/read → mark the thread read; emits `thread.updated` so the
// app's list refreshes. Reuses agent-kit's `markRead` (which returns void, so
// we re-read the updated thread with `getThread`).
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
    await markRead(id, deps);

    const thread = await getThread(id, deps);
    if (!thread) {
      return jsonResponse({ error: "thread not found" }, 404);
    }

    await appendEvent(db, {
      agentId: AGENT_ID,
      type: "thread.updated",
      payload: { thread },
    });

    return jsonResponse(thread, 200);
  } finally {
    await sql.end();
  }
};

export const config: Config = {
  path: "/threads/:id/read",
  method: "POST",
};
