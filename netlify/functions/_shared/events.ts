import { asc, gt, max } from "drizzle-orm";
import type { db as dbClient } from "../../../db/index";
import { events, type Event } from "../../../db/schema";

// Typed against the shape of the drizzle client without importing it as a
// runtime value — callers pass their own `db` instance in.
type Db = typeof dbClient;

export interface AppendEventInput {
  agentId: string;
  turnId?: string | null;
  type: string;
  payload: unknown;
}

/** Inserts a row into the cursored event log and returns it (with its `seq`). */
export async function appendEvent(
  db: Db,
  input: AppendEventInput,
): Promise<Event> {
  const [row] = await db
    .insert(events)
    .values({
      agentId: input.agentId,
      turnId: input.turnId ?? null,
      type: input.type,
      payload: input.payload,
    })
    .returning();

  if (!row) {
    throw new Error("appendEvent: insert returned no row");
  }

  return row;
}

/** Returns events with `seq > sinceSeq`, ordered by `seq` ascending. */
export async function readEvents(db: Db, sinceSeq: number): Promise<Event[]> {
  return db
    .select()
    .from(events)
    .where(gt(events.seq, sinceSeq))
    .orderBy(asc(events.seq));
}

/**
 * The true current max `seq` in the log (0 when empty). `GET /events` returns
 * this as the cursor when a poll yields no new rows, instead of echoing the
 * caller's `since` — so after a redeploy/reset (which restarts `seq`) the
 * server cursor can go *backwards*, which is exactly what trips the app's
 * cursor reset-recovery.
 */
export async function maxSeq(db: Db): Promise<number> {
  const [row] = await db.select({ value: max(events.seq) }).from(events);
  return row?.value ?? 0;
}
