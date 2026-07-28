import { randomUUID } from "node:crypto";
import type { Config } from "@netlify/functions";
import type { ActivityLogger } from "@selfctl/agent-kit/runtime";
import {
  appendAssistantMessage,
  appendUserMessage,
  getMessages,
  getThread,
  runTurn,
} from "@selfctl/agent-kit/runtime";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { pendingProposals } from "../../db/schema";
import { AGENT_ID } from "./_shared/agent";
import { requireClient } from "./_shared/auth";
import { agentSql, buildDeps } from "./_shared/deps";
import { appendEvent } from "./_shared/events";
import { redactSecrets } from "./_shared/redact";

const Body = z.object({
  threadId: z.string().uuid(),
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

// POST /message — persists the exchange and runs a real LLM turn via
// agent-kit's `runTurn`, with the thread's prior history so the agent
// remembers the conversation. The model can call `createNote`, which proposes
// a `reference.note` (nothing is written until a human approves it via
// `POST /proposals/:id/decision`). Chat state is persisted via agent-kit's
// exported `chatStore` (`@selfctl/agent-kit/runtime`); each persisted message
// is announced with a `chat.appended` event, and the thread with
// `thread.updated`. Bracketed with turn.started / proposal.created (one per
// proposal the model created) / turn.finished events, per protocol §5.
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
    const deps = await buildDeps(sql, db);
    const logger = buildActivityLogger(turnId);

    const threadId = body.threadId;

    await appendEvent(db, {
      agentId: AGENT_ID,
      turnId,
      type: "turn.started",
      payload: { turnId, threadId },
    });

    try {
      // Conversation so far, BEFORE persisting the current user message — so
      // the current input isn't double-counted in the history passed to
      // `runTurn`.
      const priorHistory = (await getMessages(threadId, deps)).map((m) => ({
        role: m.role,
        content: m.text,
      }));

      // Persist + announce the user's own line so the app can show it.
      const userMsg = await appendUserMessage(threadId, body.text, deps);
      await appendEvent(db, {
        agentId: AGENT_ID,
        turnId,
        type: "chat.appended",
        payload: { threadId, message: userMsg },
      });

      const result = await runTurn(
        {
          systemPrompt: deps.systemPrompt,
          history: priorHistory,
          userInput: body.text,
        },
        logger,
        deps,
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

      // Persist + announce the assistant reply (only on a successful turn, so
      // a failure never leaves a half-persisted turn). `cost` matches the
      // protocol's `ChatTurnCost` shape.
      const cost = {
        totalUsd: result.totalCostUsd,
        inputTokens: result.totalInputTokens,
        outputTokens: result.totalOutputTokens,
        iterations: result.iterations,
      };
      const assistantMsg = await appendAssistantMessage(
        threadId,
        result.finalText,
        {
          proposalIds: result.proposalIds,
          components: result.components,
          cost,
        },
        deps,
      );
      await appendEvent(db, {
        agentId: AGENT_ID,
        turnId,
        type: "chat.appended",
        payload: { threadId, message: assistantMsg },
      });

      // Refresh the thread in the app's list (bumped lastMessageAt, etc.).
      const thread = await getThread(threadId, deps);
      await appendEvent(db, {
        agentId: AGENT_ID,
        turnId,
        type: "thread.updated",
        payload: { thread },
      });

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
      // an HTTP error, so pollers see it. The user message is already
      // persisted (before the turn); the assistant message is only persisted
      // on success, so a failed turn never half-persists.
      console.error("message: turn error", err);
      const message = redactSecrets(
        err instanceof Error ? err.message : String(err),
      );
      await appendEvent(db, {
        agentId: AGENT_ID,
        turnId,
        type: "chat.error",
        payload: { message },
      });
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
