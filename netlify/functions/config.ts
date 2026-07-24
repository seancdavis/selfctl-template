import type { Config } from "@netlify/functions";
import { db } from "../../db";
import { getOrCreateConnectionToken, requireAdmin } from "./_shared/auth";

// GET /config/token — admin-gated. Reveals the connection token clients use
// as their bearer for the protocol endpoints. Minted lazily on first read.
export default async (req: Request): Promise<Response> => {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const connectionToken = await getOrCreateConnectionToken(db);

  return new Response(JSON.stringify({ connectionToken }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

export const config: Config = {
  path: "/config/token",
  method: "GET",
};
