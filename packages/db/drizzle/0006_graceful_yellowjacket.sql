CREATE INDEX "raw_event_received_at" ON "raw_events" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "train_position_observed_at" ON "train_positions" USING btree ("observed_at");