import { randomBytes, timingSafeEqual } from "node:crypto";
import type { db as dbClient } from "../../../db/index";
import { config } from "../../../db/schema";

// Typed against the shape of the drizzle client without importing it as a
// runtime value — callers pass their own `db` instance in.
type Db = typeof dbClient;

const BEARER_PREFIX = "Bearer ";

function bearerToken(req: Request): string | undefined {
  const header = req.headers.get("authorization");
  return header?.startsWith(BEARER_PREFIX)
    ? header.slice(BEARER_PREFIX.length)
    : undefined;
}

/**
 * Constant-time string comparison for bearer tokens. Guards the byte length
 * first (`timingSafeEqual` throws on mismatched lengths) so that a length
 * mismatch also fails closed rather than throwing.
 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  if (bufA.length !== bufB.length) {
    return false;
  }

  return timingSafeEqual(bufA, bufB);
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Gates `/config/*`. Checks `Authorization: Bearer <token>` against the
 * deploy-time root secret `AGENT_ADMIN_KEY`. Returns a 401 `Response` when
 * the header is missing or the key doesn't match; returns `null` when the
 * request is authorized, so callers can `return maybeRes;`.
 */
export function requireAdmin(req: Request): Response | null {
  const expected = process.env.AGENT_ADMIN_KEY;
  const token = bearerToken(req);

  if (!expected || !token || !safeEqual(token, expected)) {
    return unauthorized();
  }

  return null;
}

/**
 * Returns the single `config` row's connection token, minting one (and the
 * row) on first read. The connection token is the bearer clients use for the
 * protocol endpoints — it's revealed only through the admin-gated UI.
 */
export async function getOrCreateConnectionToken(db: Db): Promise<string> {
  const [existing] = await db.select().from(config).limit(1);
  if (existing) {
    return existing.connectionToken;
  }

  // Race-safe mint: `singleton` carries a unique constraint, so if two
  // requests both see no row and race to insert, only one insert lands and
  // the other is a no-op. Either way, the re-select below returns the one
  // row that actually exists, so concurrent first-mints converge on the same
  // token instead of erroring or creating a second row.
  const connectionToken = randomBytes(24).toString("hex");
  await db
    .insert(config)
    .values({ connectionToken, singleton: true })
    .onConflictDoNothing();

  const [row] = await db.select().from(config).limit(1);

  if (!row) {
    throw new Error("getOrCreateConnectionToken: no config row after insert");
  }

  return row.connectionToken;
}

/**
 * Gates the protocol endpoints (`/message`, `/events`,
 * `/proposals/:id/decision`, `/summary`). Checks `Authorization: Bearer
 * <token>` against either the stored connection token or `AGENT_ADMIN_KEY`
 * (admin can do anything). Returns a 401 `Response` when unauthorized;
 * returns `null` when the request is authorized, so callers can
 * `return await requireClient(req, db);`.
 */
export async function requireClient(
  req: Request,
  db: Db,
): Promise<Response | null> {
  const token = bearerToken(req);
  if (!token) {
    return unauthorized();
  }

  const adminKey = process.env.AGENT_ADMIN_KEY;
  if (adminKey && safeEqual(token, adminKey)) {
    return null;
  }

  const connectionToken = await getOrCreateConnectionToken(db);
  if (!safeEqual(token, connectionToken)) {
    return unauthorized();
  }

  return null;
}
