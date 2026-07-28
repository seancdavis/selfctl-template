import type { Config } from "@netlify/functions";
import { createThread, listThreads } from "@selfctl/agent-kit/runtime";
import { z } from "zod";
import { db } from "../../db";
import { AGENT_ID } from "./_shared/agent";
import { requireClient } from "./_shared/auth";
import { agentSql, buildDeps } from "./_shared/deps";
import { appendEvent } from "./_shared/events";

const CreateBody = z.object({
  title: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// GET /threads  → list this agent's chat threads (newest activity first).
// POST /threads → create a thread {title, model}; emits `thread.created`.
// Both reuse agent-kit's exported `chatStore` (@selfctl/agent-kit/runtime),
// which runs against the postgres.js client `buildDeps` provides.
export default async (req: Request): Promise<Response> => {
  const unauthorized = await requireClient(req, db);
  if (unauthorized) return unauthorized;

  const sql = agentSql();
  try {
    const deps = await buildDeps(sql, db);

    if (req.method === "GET") {
      const threads = await listThreads(AGENT_ID, deps);
      return jsonResponse(threads, 200);
    }

    let body: z.infer<typeof CreateBody>;
    try {
      body = CreateBody.parse(await req.json());
    } catch {
      return jsonResponse({ error: "invalid body" }, 400);
    }

    const thread = await createThread(
      AGENT_ID,
      body.title ?? null,
      body.model ?? null,
      deps,
    );

    await appendEvent(db, {
      agentId: AGENT_ID,
      type: "thread.created",
      payload: { thread },
    });

    return jsonResponse(thread, 200);
  } finally {
    await sql.end();
  }
};

export const config: Config = {
  path: "/threads",
  method: ["GET", "POST"],
};
