import {
  bigserial,
  boolean,
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
// proposal a human decides, never an unmediated write.
export const proposals = pgTable("proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: text("agent_id").notNull(),
  turnId: uuid("turn_id"),
  kind: text("kind").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

// The stub proposal kind's write target: `reference.note` proposals, once
// approved, land a row here.
export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  text: text("text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// Single-row deploy config: holds the minted connection token clients use as
// their bearer (auth model in the README/handoff — two tiers, this is the
// non-admin one). `singleton` is always `true` and carries a unique
// constraint, so the database itself enforces that at most one row can ever
// exist. `getOrCreateConnectionToken` creates it lazily and race-safely on
// first read.
export const config = pgTable("config", {
  id: uuid("id").primaryKey().defaultRandom(),
  connectionToken: text("connection_token").notNull(),
  singleton: boolean("singleton").notNull().default(true).unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type Proposal = typeof proposals.$inferSelect;
export type NewProposal = typeof proposals.$inferInsert;
export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;
export type Config = typeof config.$inferSelect;
export type NewConfig = typeof config.$inferInsert;
