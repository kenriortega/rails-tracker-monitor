CREATE EXTENSION IF NOT EXISTS postgis;--> statement-breakpoint
CREATE TYPE "public"."position_quality" AS ENUM('reported', 'estimated', 'stale', 'unknown');--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"tiploc" text,
	"stanox" text,
	"crs" text,
	"point" geometry(point)
);
--> statement-breakpoint
CREATE TABLE "raw_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feed" text NOT NULL,
	"deduplication_key" text NOT NULL,
	"observed_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"uid" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date NOT NULL,
	"stp_indicator" text NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_run_id" text NOT NULL,
	"service_date" date NOT NULL,
	"schedule_id" uuid,
	"headcode" text,
	"status" text NOT NULL,
	"delay_seconds" integer
);
--> statement-breakpoint
CREATE TABLE "track_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"source_reference" text NOT NULL,
	"geometry" geometry(LineString,4326) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "train_positions" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"point" geometry(point),
	"quality" "position_quality" NOT NULL,
	"source" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "service_runs" ADD CONSTRAINT "service_runs_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "train_positions" ADD CONSTRAINT "train_positions_run_id_service_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."service_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "location_point_gist" ON "locations" USING gist ("point");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_event_deduplication" ON "raw_events" USING btree ("feed","deduplication_key");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_version" ON "schedules" USING btree ("uid","valid_from","stp_indicator");--> statement-breakpoint
CREATE UNIQUE INDEX "service_run_identity" ON "service_runs" USING btree ("provider","service_date","provider_run_id");--> statement-breakpoint
CREATE INDEX "track_geometry_gist" ON "track_segments" USING gist ("geometry");--> statement-breakpoint
CREATE INDEX "train_position_gist" ON "train_positions" USING gist ("point");
