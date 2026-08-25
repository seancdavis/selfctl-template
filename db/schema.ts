import { sql } from "drizzle-orm";
import {
  bigserial,
  check,
  index,
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
// `skills/notes.ts`): once a proposal is approved or overridden, its
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

// Chat threads + messages — the conversational transport state agent-kit
// 0.2.0's exported `chatStore` (`@selfctl/agent-kit/runtime`:
// createThread/listThreads/getThread/getMessages/appendUserMessage/
// appendAssistantMessage/setThreadTitle/markRead) reads and writes via raw
// postgres.js SQL. Like `pending_proposals`, the column names and types here
// mirror agent-kit's own chat DDL (`migrations/0003_chat.sql` +
// `0004_chat_model.sql`) precisely — chatStore addresses columns by name, so
// they're load-bearing. This is trusted gate-half state (the same tier as the
// `events` log), never written through the proposal/approval flow.
export const chatThreads = pgTable(
  "chat_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: text("agent_id").notNull(),
    title: text("title"),
    // Per-conversation model pin (agent-kit ADR-0018): NULL means "use the
    // agent's default model". Set at thread create, never changed after.
    model: text("model"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastReadAt: timestamp("last_read_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("chat_threads_agent_last_message_idx").on(
      table.agentId,
      table.lastMessageAt.desc(),
    ),
  ],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => chatThreads.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    text: text("text").notNull(),
    ts: timestamp("ts", { withTimezone: true }).defaultNow().notNull(),
    proposalIds: uuid("proposal_ids").array(),
    components: jsonb("components"),
    cost: jsonb("cost"),
    retryAttempt: integer("retry_attempt"),
  },
  (table) => [
    check(
      "chat_messages_role_check",
      sql`${table.role} IN ('user', 'assistant')`,
    ),
    index("chat_messages_thread_ts_idx").on(table.threadId, table.ts),
  ],
);

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type PendingProposal = typeof pendingProposals.$inferSelect;
export type NewPendingProposal = typeof pendingProposals.$inferInsert;
export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;
export type Config = typeof config.$inferSelect;
export type NewConfig = typeof config.$inferInsert;
export type ChatThread = typeof chatThreads.$inferSelect;
export type NewChatThread = typeof chatThreads.$inferInsert;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
