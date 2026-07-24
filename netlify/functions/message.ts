import { randomUUID } from "node:crypto";
import type { Config } from "@netlify/functions";
import type { ActivityLogger } from "@selfctl/agent-kit/runtime";
import { createOpenRouterClient, runTurn } from "@selfctl/agent-kit/runtime";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { pendingProposals } from "../../db/schema";
import { AGENT_ID } from "./_shared/agent";
import { requireClient } from "./_shared/auth";
import { agentSql, buildDeps } from "./_shared/deps";
import { appendEvent } from "./_shared/events";
import { SYSTEM_PROMPT } from "./_shared/system";

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

/**
 * A custom `ActivityLogger` that lands every activity entry `runTurn` emits
 * (llm.call, tool.call, agent.turn, etc.) in this agent's own `events` log,
 * tagged with the turn's id — agent-kit's own activity table
 * (`agent_activity_log`) is a daemon-only concern this stateless binding
 * doesn't use.
 */
function buildActivityLogger(turnId: string): ActivityLogger {
  return {
    log: async (entry) => {
      await appendEvent(db, {
        agentId: AGENT_ID,
        turnId,
        type: entry.eventType,
        payload: { data: entry.payload, tokenUsage: entry.tokenUsage ?? null },
      });
    },
  };
}

// POST /message — runs a real LLM turn via agent-kit's `runTurn`. The model
// can call `createNote`, which proposes a `reference.note` (nothing is
// written until a human approves it via `POST /proposals/:id/decision`).
// Bracketed with turn.started / proposal.created (one per proposal the model
// created) / turn.finished events, per protocol §5.
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
  const sql = agentSql();

  try {
    const deps = buildDeps(sql);
    const logger = buildActivityLogger(turnId);

    await appendEvent(db, {
      agentId: AGENT_ID,
      turnId,
      type: "turn.started",
      payload: { turnId, threadId: body.threadId ?? null },
    });

    try {
      const openrouter = createOpenRouterClient(deps.config);
      const result = await runTurn(
        { systemPrompt: SYSTEM_PROMPT, history: [], userInput: body.text },
        logger,
        deps,
        openrouter,
      );

      for (const proposalId of result.proposalIds) {
        const [proposal] = await db
          .select()
          .from(pendingProposals)
          .where(eq(pendingProposals.id, proposalId))
          .limit(1);

        if (proposal) {
          await appendEvent(db, {
            agentId: AGENT_ID,
            turnId,
            type: "proposal.created",
            payload: { proposal },
          });
        }
      }

      await appendEvent(db, {
        agentId: AGENT_ID,
        turnId,
        type: "turn.finished",
        payload: { turnId, status: "ok" },
      });
    } catch (err) {
      // Covers agent-kit's CostCapExceededError / TurnCeilingExceededError
      // and any other failure mid-turn. Those error classes aren't exported
      // from the published package (verified against dist/*.d.ts), so this
      // can't `instanceof`-narrow them — but the protocol's contract here is
      // the same regardless: surface the failure in the event stream, not as
      // an HTTP error, so pollers see it.
      const message = err instanceof Error ? err.message : String(err);
      await appendEvent(db, {
        agentId: AGENT_ID,
        turnId,
        type: "turn.finished",
        payload: { turnId, status: "error", error: message },
      });
    }

    return jsonResponse({ turnId }, 200);
  } finally {
    await sql.end();
  }
};

export const config: Config = {
  path: "/message",
  method: "POST",
};
