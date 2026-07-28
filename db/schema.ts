import { sql } from "drizzle-orm";
import {
  bigserial,
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// The cursored protocol event log (spec §5). `seq` is the cursor: a
// monotonic, gap-free, per-agent sequence that `GET /events?since=` polls.
export const events = pgTable("events", {
  seq: bigserial("seq", { mode: "number" }).primaryKey(),
  agentId: text("agent_id").notNull(),
  turnId: uuid("turn_id"),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
  ts: timestamp("ts", { withTimezone: true }).defaultNow().notNull(),
});

// Proposals are the deterministic gate (spec §7.6): every domain write is a
// proposal a human decides, never an unmediated write. `pending_proposals` is
// the exact table agent-kit's gate (`@selfctl/agent-kit/runtime`) reads and
// writes via raw postgres.js SQL — the name and column set here mirror
// agent-kit's own `0001_proposals.sql` precisely (id, agent_id, kind,
// payload, status, feedback_note, parent_proposal_id, created_at,
// resolved_at). There is deliberately no `turn_id`: agent-kit's INSERT never
// sets one, and turn correlation already lives in the `events` log via each
// event's own `turn_id` column.
export const pendingProposals = pgTable("pending_proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: text("agent_id").notNull(),
  kind: text("kind").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull().default("pending"),
  feedbackNote: text("feedback_note"),
  parentProposalId: uuid("parent_proposal_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

// The `reference.note` proposal kind's write target (see
// `_shared/skills/notes.ts`): once a proposal is approved or overridden, its
// `write()` lands a row here.
export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  text: text("text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// Single-row deploy config: holds the minted connection token clients use as
// their bearer (auth model in the README/handoff — two tiers, this is the
// non-admin one). `id` is fixed to `1` and a check constraint enforces it, so
// the database itself guarantees at most one row can ever exist — not just
// at most one "true" row. `getOrCreateConnectionToken` creates it lazily and
// race-safely on first read.
export const config = pgTable(
  "config",
  {
    id: integer("id").primaryKey().default(1),
    connectionToken: text("connection_token").notNull(),
    // Model + provider selection for `runTurn` (agent-kit 0.2.0's AIG/Anthropic
    // provider seam). Defaults ARE the seed: a fresh deploy thinks on Netlify
    // AI Gateway out-of-the-box, no third-party account or key required. The
    // `openrouter` provider stays available as a future opt-in (see
    // netlify.toml) but is not wired here.
    provider: text("provider").notNull().default("netlify-aig"),
    model: text("model").notNull().default("claude-haiku-4-5"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [check("config_single_row", sql`${table.id} = 1`)],
);

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type PendingProposal = typeof pendingProposals.$inferSelect;
export type NewPendingProposal = typeof pendingProposals.$inferInsert;
export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;
export type Config = typeof config.$inferSelect;
export type NewConfig = typeof config.$inferInsert;
