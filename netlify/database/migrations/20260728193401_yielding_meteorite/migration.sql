ALTER TABLE "config" ADD COLUMN "provider" text DEFAULT 'netlify-aig' NOT NULL;--> statement-breakpoint
ALTER TABLE "config" ADD COLUMN "model" text DEFAULT 'claude-haiku-4-5' NOT NULL;