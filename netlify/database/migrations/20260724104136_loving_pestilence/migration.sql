CREATE TABLE "config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"connection_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
