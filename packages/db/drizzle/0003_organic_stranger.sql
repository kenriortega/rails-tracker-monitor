CREATE TABLE "projection_state" (
	"name" text PRIMARY KEY NOT NULL,
	"last_received_at" timestamp with time zone NOT NULL,
	"last_event_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
