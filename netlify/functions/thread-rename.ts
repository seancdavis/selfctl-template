import type { Config, Context } from "@netlify/functions";
import { getThread, setThreadTitle } from "@selfctl/agent-kit/runtime";
import { z } from "zod";
import { db } from "../../db";
import { AGENT_ID } from "./_shared/agent";
import { requireClient } from "./_shared/auth";
import { agentSql, buildDeps } from "./_shared/deps";
import { appendEvent } from "./_shared/events";

const RenameBody = z.object({
  title: z.string().min(1),
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// POST /threads/:id/rename {title} → set the thread's title; emits
// `thread.updated` so the app's list refreshes. Reuses agent-kit's
// `setThreadTitle` (which returns void, so we re-read with `getThread`).
export default async (req: Request, context: Context): Promise<Response> => {
  const unauthorized = await requireClient(req, db);
  if (unauthorized) return unauthorized;

  const id = context.params.id;
  if (!id) {
    return jsonResponse({ error: "missing thread id" }, 400);
  }

  let body: z.infer<typeof RenameBody>;
  try {
    body = RenameBody.parse(await req.json());
  } catch {
    return jsonResponse({ error: "invalid body" }, 400);
  }

  const sql = agentSql();
  try {
    const deps = await buildDeps(sql, db);
    await setThreadTitle(id, body.title, deps);

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
  path: "/threads/:id/rename",
  method: "POST",
};
