CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"thread_id" uuid NOT NULL,
	"role" text NOT NULL,
	"text" text NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"proposal_ids" uuid[],
	"components" jsonb,
	"cost" jsonb,
	"retry_attempt" integer,
	CONSTRAINT "chat_messages_role_check" CHECK ("role" IN ('user', 'assistant'))
);
--> statement-breakpoint
CREATE TABLE "chat_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"agent_id" text NOT NULL,
	"title" text,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "chat_messages_thread_ts_idx" ON "chat_messages" ("thread_id","ts");--> statement-breakpoint
CREATE INDEX "chat_threads_agent_last_message_idx" ON "chat_threads" ("agent_id","last_message_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_thread_id_chat_threads_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "chat_threads"("id") ON DELETE CASCADE;