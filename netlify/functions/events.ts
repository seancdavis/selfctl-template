import type { Config } from "@netlify/functions";
import { db } from "../../db";
import { requireClient } from "./_shared/auth";
import { maxSeq, readEvents } from "./_shared/events";

// GET /events?since=<seq> — the whole live channel over HTTP (protocol §5).
// Poll it; cursor is the max seq returned, or — when idle — the log's true
// current max seq (not the echoed `since`), so a redeploy/reset that restarts
// `seq` moves the server cursor backwards and trips the app's reset-recovery.
export default async (req: Request): Promise<Response> => {
  const unauthorized = await requireClient(req, db);
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  const sinceParam = url.searchParams.get("since");
  const parsed = sinceParam ? Number(sinceParam) : 0;
  const since = Number.isFinite(parsed) ? parsed : 0;

  // Sample the max seq BEFORE reading, so the idle cursor can't skip an event
  // that lands mid-request. If a row is inserted between this sample and
  // `readEvents`, `readEvents` (running second) still has `seq > since` and
  // returns it, so `cursor = last.seq` delivers it now. If a row lands after
  // `readEvents`, this batch is empty and `cursor = before < newSeq`, so the
  // next poll (`since = before`) returns it. Either way, no silent skip.
  const before = await maxSeq(db);
  const rows = await readEvents(db, since);
  const last = rows[rows.length - 1];
  const cursor = last ? last.seq : before;

  return new Response(JSON.stringify({ events: rows, cursor }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

export const config: Config = {
  path: "/events",
  method: "GET",
};
