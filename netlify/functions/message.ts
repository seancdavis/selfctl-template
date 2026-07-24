import { randomUUID } from "node:crypto";
import type { Config } from "@netlify/functions";
import { z } from "zod";
import { db } from "../../db";
import { proposals } from "../../db/schema";
import { AGENT_ID } from "./_shared/agent";
import { requireClient } from "./_shared/auth";
import { appendEvent } from "./_shared/events";

const Body = z.object({
  threadId: z.string().optional(),
  text: z.string().min(1),
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// POST /message — starts a stubbed turn. No LLM yet: it deterministically
// appends turn.started, proposes a `reference.note` from the raw text,
// appends proposal.created, then turn.finished. Real turn logic (agent-kit)
// lands in a later phase; the protocol shape is the point of this endpoint.
export default async (req: Request): Promise<Response> => {
  const unauthorized = await requireClient(req, db);
  if (unauthorized) return unauthorized;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return jsonResponse({ error: "invalid body" }, 400);
  }

  const turnId = randomUUID();

  await appendEvent(db, {
    agentId: AGENT_ID,
    turnId,
    type: "turn.started",
    payload: { turnId, threadId: body.threadId ?? null },
  });

  const [proposal] = await db
    .insert(proposals)
    .values({
      agentId: AGENT_ID,
      turnId,
      kind: "reference.note",
      payload: { text: body.text },
    })
    .returning();

  if (!proposal) {
    throw new Error("message: proposal insert returned no row");
  }

  await appendEvent(db, {
    agentId: AGENT_ID,
    turnId,
    type: "proposal.created",
    payload: { proposal },
  });

  await appendEvent(db, {
    agentId: AGENT_ID,
    turnId,
    type: "turn.finished",
    payload: { turnId, status: "ok" },
  });

  return jsonResponse({ turnId }, 200);
};

export const config: Config = {
  path: "/message",
  method: "POST",
};
