ALTER TABLE "proposals" RENAME TO "pending_proposals";--> statement-breakpoint
ALTER TABLE "pending_proposals" ADD COLUMN "feedback_note" text;--> statement-breakpoint
ALTER TABLE "pending_proposals" ADD COLUMN "parent_proposal_id" uuid;--> statement-breakpoint
ALTER TABLE "pending_proposals" DROP COLUMN "turn_id";