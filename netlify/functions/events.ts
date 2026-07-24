import type { Config } from "@netlify/functions";
import { db } from "../../db";
import { requireClient } from "./_shared/auth";
import { readEvents } from "./_shared/events";

// GET /events?since=<seq> — the whole live channel over HTTP (protocol §5).
// Poll it; cursor is the max seq returned, or the since value when idle.
export default async (req: Request): Promise<Response> => {
  const unauthorized = await requireClient(req, db);
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  const sinceParam = url.searchParams.get("since");
  const parsed = sinceParam ? Number(sinceParam) : 0;
  const since = Number.isFinite(parsed) ? parsed : 0;

  const rows = await readEvents(db, since);
  const last = rows[rows.length - 1];
  const cursor = last ? last.seq : since;

  return new Response(JSON.stringify({ events: rows, cursor }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

export const config: Config = {
  path: "/events",
  method: "GET",
};
