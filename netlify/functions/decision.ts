import type { Config, Context } from "@netlify/functions";
import {
  approve,
  override,
  reject,
  rejectWithFeedback,
} from "@selfctl/agent-kit/runtime";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { pendingProposals } from "../../db/schema";
import { AGENT_ID } from "./_shared/agent";
import { requireClient } from "./_shared/auth";
import { agentSql, buildDeps } from "./_shared/deps";
import { appendEvent } from "./_shared/events";

const DecisionBody = z.object({
  verb: z.enum(["approve", "reject", "override"]),
  note: z.string().optional(),
  payload: z.unknown().optional(),
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// POST /proposals/:id/decision — the deterministic gate, for real: routes to
// agent-kit's `approve`/`reject`/`rejectWithFeedback`/`override`
// (`@selfctl/agent-kit/runtime`), which run the proposal kind's `write()`
// inside a DB transaction for approve/override. Returns the resolved
// proposal synchronously (protocol §4).
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

  // Pre-check existence/pending status ourselves: agent-kit's not-found /
  // not-pending errors (`ProposalNotFoundError` / `ProposalNotPendingError`)
  // aren't exported from the published package (verified against
  // dist/*.d.ts), so this is the "guard before calling" alternative the spec
  // calls out — it also lets us return a clean 404/409 instead of a raw 500.
  const [existing] = await db
    .select()
    .from(pendingProposals)
    .where(eq(pendingProposals.id, id))
    .limit(1);

  if (!existing) {
    return jsonResponse({ error: "proposal not found" }, 404);
  }
  if (existing.status !== "pending") {
    return jsonResponse({ error: "proposal is not pending" }, 409);
  }

  const sql = agentSql();
  try {
    const deps = await buildDeps(sql, db);

    if (body.verb === "override") {
      const kindDef = deps.registry.proposalKind(existing.kind);
      if (!kindDef || !kindDef.schema.safeParse(body.payload).success) {
        return jsonResponse(
          { error: "override payload invalid for this proposal kind" },
          400,
        );
      }
    }

    let resolved: Awaited<ReturnType<typeof approve>>;
    try {
      if (body.verb === "approve") {
        resolved = await approve(id, deps);
      } else if (body.verb === "reject") {
        resolved = body.note
          ? await rejectWithFeedback(id, body.note, deps)
          : await reject(id, deps);
      } else {
        resolved = await override(id, body.payload, deps);
      }
    } catch (err) {
      // Our guard above already confirmed the proposal existed and was
      // pending, so a thrown error here means one of two things: either it
      // was resolved concurrently between that check and the gate's own row
      // lock (a race — 409), or the gate itself failed for a real reason
      // (e.g. the skill's `write()` errored — 500). Re-read the row to tell
      // them apart, since agent-kit's error classes aren't exported from the
      // published package (verified against dist/*.d.ts) and can't be
      // `instanceof`-narrowed. Never echo `err.message` to the client — log
      // it server-side only.
      console.error("decision: gate error", err);

      const [after] = await db
        .select()
        .from(pendingProposals)
        .where(eq(pendingProposals.id, id))
        .limit(1);

      if (!after || after.status !== "pending") {
        return jsonResponse({ error: "proposal is no longer pending" }, 409);
      }
      return jsonResponse({ error: "failed to resolve proposal" }, 500);
    }

    await appendEvent(db, {
      agentId: AGENT_ID,
      type: "proposal.resolved",
      payload: { proposal: resolved },
    });

    return jsonResponse(resolved, 200);
  } finally {
    await sql.end();
  }
};

export const config: Config = {
  path: "/proposals/:id/decision",
  method: "POST",
};
