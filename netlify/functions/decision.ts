import type { Config, Context } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { notes, proposals } from "../../db/schema";
import { AGENT_ID } from "./_shared/agent";
import { requireClient } from "./_shared/auth";
import { appendEvent } from "./_shared/events";

const DecisionBody = z.object({
  verb: z.enum(["approve", "reject", "override"]),
  note: z.string().optional(),
  payload: z.unknown().optional(),
});

// The stub proposal kind's payload shape: `reference.note` proposals carry
// the raw text a client sent in via `POST /message`.
const NotePayload = z.object({ text: z.string() });

const STATUS_BY_VERB = {
  approve: "approved",
  reject: "rejected",
  override: "overridden",
} as const;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// POST /proposals/:id/decision — the deterministic gate. `approve` writes the
// proposal's own payload to `notes`; `override` writes the caller-supplied
// payload instead; `reject` writes nothing. Returns the resolved proposal
// synchronously (protocol §4).
export default async (req: Request, context: Context): Promise<Response> => {
  const unauthorized = await requireClient(req, db);
  if (unauthorized) return unauthorized;

  const id = context.params.id;
  if (!id) {
    return jsonResponse({ error: "missing proposal id" }, 400);
  }

  let body: z.infer<typeof DecisionBody>;
  try {
    body = DecisionBody.parse(await req.json());
  } catch {
    return jsonResponse({ error: "invalid body" }, 400);
  }

  const [proposal] = await db
    .select()
    .from(proposals)
    .where(eq(proposals.id, id))
    .limit(1);

  if (!proposal) {
    return jsonResponse({ error: "proposal not found" }, 404);
  }

  if (proposal.status !== "pending") {
    return jsonResponse({ error: "proposal is not pending" }, 409);
  }

  if (body.verb === "approve") {
    const { text } = NotePayload.parse(proposal.payload);
    await db.insert(notes).values({ text });
  } else if (body.verb === "override") {
    const parsedPayload = NotePayload.safeParse(body.payload);
    if (!parsedPayload.success) {
      return jsonResponse({ error: "override requires payload.text" }, 400);
    }
    await db.insert(notes).values({ text: parsedPayload.data.text });
  }

  const [resolved] = await db
    .update(proposals)
    .set({
      status: STATUS_BY_VERB[body.verb],
      resolvedAt: new Date(),
    })
    .where(eq(proposals.id, id))
    .returning();

  if (!resolved) {
    throw new Error("decision: update returned no row");
  }

  await appendEvent(db, {
    agentId: AGENT_ID,
    turnId: resolved.turnId,
    type: "proposal.resolved",
    payload: { proposal: resolved },
  });

  return jsonResponse(resolved, 200);
};

export const config: Config = {
  path: "/proposals/:id/decision",
  method: "POST",
};
