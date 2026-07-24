import type { Config } from "@netlify/functions";
import { db } from "../../db";
import { AGENT_ID, DISPLAY_NAME, PROTOCOL_VERSION } from "./_shared/agent";
import { requireClient } from "./_shared/auth";

// GET /summary — identity + capability discovery (protocol §3).
export default async (req: Request): Promise<Response> => {
  const unauthorized = await requireClient(req, db);
  if (unauthorized) return unauthorized;

  return new Response(
    JSON.stringify({
      agentId: AGENT_ID,
      displayName: DISPLAY_NAME,
      protocolVersion: PROTOCOL_VERSION,
      transports: ["http"],
      capabilities: ["message", "events", "decision"],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
};

export const config: Config = {
  path: "/summary",
  method: "GET",
};
