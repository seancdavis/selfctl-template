import type { Config } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { config as configTable } from "../../db/schema";
import { getOrCreateConnectionToken, requireAdmin } from "./_shared/auth";
import { CURATED_MODELS } from "./_shared/curated-models";

const UpdateBody = z.object({
  model: z.enum(CURATED_MODELS),
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// GET /config/settings  → admin-gated (same gate as `/config/token`, NOT the
// connection-token gate `requireClient` uses). Returns the config row's
// current `provider`/`model` plus the curated list the UI renders as
// options — the endpoint is the one place that list is defined, so the UI
// never carries its own copy that could drift.
// POST /config/settings {model} → admin-gated; validates `model` against the
// curated list (else 400 — arbitrary values are rejected, not just
// non-strings), then updates the single `config` row (`id = 1`). `provider`
// stays fixed at `netlify-aig`; a provider-switch UI is future work.
export default async (req: Request): Promise<Response> => {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  // Ensures the row exists (race-safe, same helper `/config/token` uses) so
  // a settings call before any token has ever been minted still reads/writes
  // a real row instead of the in-code defaults.
  await getOrCreateConnectionToken(db);

  if (req.method === "GET") {
    const [row] = await db.select().from(configTable).limit(1);
    if (!row) {
      return jsonResponse({ error: "config row not found" }, 404);
    }
    return jsonResponse(
      { provider: row.provider, model: row.model, models: CURATED_MODELS },
      200,
    );
  }

  let body: z.infer<typeof UpdateBody>;
  try {
    body = UpdateBody.parse(await req.json());
  } catch {
    return jsonResponse({ error: "invalid model" }, 400);
  }

  const [updated] = await db
    .update(configTable)
    .set({ model: body.model })
    .where(eq(configTable.id, 1))
    .returning();

  if (!updated) {
    return jsonResponse({ error: "config row not found" }, 404);
  }

  return jsonResponse({ provider: updated.provider, model: updated.model }, 200);
};

export const config: Config = {
  path: "/config/settings",
  method: ["GET", "POST"],
};
