CREATE TABLE "selfctl_assets" (
	"id" text PRIMARY KEY,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "image_asset_id" text;