import { sql } from "drizzle-orm";
import { bigint, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, geometry, date, customType, pgEnum } from "drizzle-orm/pg-core";
export const positionQuality = pgEnum("position_quality", ["reported", "estimated", "stale", "unknown"]);
export const locations = pgTable("locations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(), tiploc: text("tiploc"), stanox: text("stanox"), crs: text("crs"),
  point: geometry("point", {type: "point", mode: "tuple", srid: 4326}),
}, table => [index("location_point_gist").using("gist", table.point), uniqueIndex("location_tiploc").on(table.tiploc), check("location_point_wgs84", sql`${table.point} IS NULL OR ST_SRID(${table.point}) = 4326`)]);
const lineString = customType<{ data: string }>({ dataType: () => "geometry(LineString,4326)" });
export const trackSegments = pgTable("track_segments", {
  id: uuid("id").defaultRandom().primaryKey(), source: text("source").notNull(),
  sourceReference: text("source_reference").notNull(), geometry: lineString("geometry").notNull(),
}, table => [index("track_geometry_gist").using("gist", table.geometry)]);
export const schedules = pgTable("schedules", {
  id: uuid("id").defaultRandom().primaryKey(), uid: text("uid").notNull(),
  validFrom: date("valid_from").notNull(), validTo: date("valid_to").notNull(),
  stpIndicator: text("stp_indicator").notNull(), payload: jsonb("payload").notNull(),
}, table => [uniqueIndex("schedule_version").on(table.uid, table.validFrom, table.stpIndicator)]);
export const serviceRuns = pgTable("service_runs", {
  id: uuid("id").defaultRandom().primaryKey(), provider: text("provider").notNull(),
  providerRunId: text("provider_run_id").notNull(), serviceDate: date("service_date").notNull(),
  scheduleId: uuid("schedule_id").references(() => schedules.id), headcode: text("headcode"), tocId: text("toc_id"),
  status: text("status").notNull(), delaySeconds: integer("delay_seconds"),
}, table => [uniqueIndex("service_run_identity").on(table.provider, table.serviceDate, table.providerRunId)]);
export const rawEvents = pgTable("raw_events", {
  id: uuid("id").defaultRandom().primaryKey(), feed: text("feed").notNull(),
  deduplicationKey: text("deduplication_key").notNull(),
  observedAt: timestamp("observed_at", {withTimezone: true}),
  receivedAt: timestamp("received_at", {withTimezone: true}).defaultNow().notNull(),
  payload: jsonb("payload").notNull(),
}, table => [uniqueIndex("raw_event_deduplication").on(table.feed, table.deduplicationKey),
   /** La poda recorre por recepción; sin este índice barrería la tabla entera. */
   index("raw_event_received_at").on(table.receivedAt),
   /** El recorrido de un tren se reconstruye filtrando por su identificador. */
   index("raw_event_train_id").on(sql`((${table.payload}->'body'->>'train_id'))`)]);
export const trainPositions = pgTable("train_positions", {
  runId: uuid("run_id").primaryKey().references(() => serviceRuns.id),
  point: geometry("point", {type: "point", mode: "tuple", srid: 4326}),
  quality: positionQuality("quality").notNull(), source: text("source").notNull(),
  observedAt: timestamp("observed_at", {withTimezone: true}).notNull(),
  receivedAt: timestamp("received_at", {withTimezone: true}).notNull(),
  /** Monótona por escritura: cursor reanudable para los deltas por SSE. */
  version: bigint("version", {mode: "number"}).notNull().default(sql`nextval('train_position_version')`),
}, table => [index("train_position_version_idx").on(table.version), index("train_position_observed_at").on(table.observedAt), index("train_position_gist").using("gist", table.point), check("train_position_wgs84", sql`${table.point} IS NULL OR ST_SRID(${table.point}) = 4326`)]);

/** Cursor de proyección: permite reprocesar raw_events tras corregir la lógica. */
export const projectionState = pgTable("projection_state", {
  name: text("name").primaryKey(),
  lastReceivedAt: timestamp("last_received_at", {withTimezone: true}).notNull(),
  lastEventId: uuid("last_event_id").notNull(),
  updatedAt: timestamp("updated_at", {withTimezone: true}).defaultNow().notNull(),
});
