import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { createDatabase } from "@rails/db";
import { MOVEMENT_FEED } from "./records";
import { PROVIDER, projectMovement } from "./projection";

const CURSOR = "movement";
const PAGE = 1000;

type Database = ReturnType<typeof createDatabase>["db"];

interface Totals { read: number; projected: number; skipped: number; positions: number; unresolved: number }

/**
 * Pasada separada de la ingesta: lee raw_events con un cursor estable sobre
 * (received_at, id). Al ir aparte, un error de proyección no detiene la ingesta
 * y la proyección puede rehacerse desde cero tras corregir la lógica.
 */
async function projectPage(db: Database, totals: Totals): Promise<boolean> {
  const cursor = await db.execute(sql`
    select last_received_at, last_event_id from projection_state where name = ${CURSOR}`);
  const previous = cursor.rows[0] as {last_received_at: Date; last_event_id: string} | undefined;

  const pending = await db.execute(sql`
    select id, payload, received_at from raw_events
    where feed = ${MOVEMENT_FEED}
      ${previous ? sql`and (received_at, id) > (${previous.last_received_at}, ${previous.last_event_id})` : sql``}
    order by received_at, id
    limit ${PAGE}`);
  const events = pending.rows as {id: string; payload: unknown; received_at: Date}[];
  if (!events.length) return false;

  for (const event of events) {
    totals.read++;
    const movement = projectMovement(event.payload, event.received_at);
    if (!movement) { totals.skipped++; continue; }
    totals.projected++;

    const run = await db.execute(sql`
      insert into service_runs (provider, provider_run_id, service_date, status, delay_seconds)
      values (${PROVIDER}, ${movement.providerRunId}, ${movement.serviceDate}, ${movement.status}, ${movement.delaySeconds})
      on conflict (provider, service_date, provider_run_id) do update set
        status = excluded.status, delay_seconds = coalesce(excluded.delay_seconds, service_runs.delay_seconds)
      returning id`);
    const runId = (run.rows[0] as {id: string}).id;

    /**
     * Un STANOX puede corresponder a varios TIPLOC con puntos distintos. En ese
     * caso no se elige uno: la posición queda `unknown` en lugar de inventada.
     */
    const resolved = movement.stanox
      ? await db.execute(sql`
          select count(distinct point)::int as points, min(point) as point
          from locations where stanox = ${movement.stanox} and point is not null`)
      : null;
    const row = resolved?.rows[0] as {points: number; point: string | null} | undefined;
    const unique = row && row.points === 1;
    if (unique) totals.positions++; else totals.unresolved++;

    // Un evento más antiguo no debe pisar una posición más reciente.
    await db.execute(sql`
      insert into train_positions (run_id, point, quality, source, observed_at, received_at)
      values (${runId}, ${unique ? sql`${row!.point}::geometry` : sql`null`},
              ${unique ? "reported" : "unknown"}, ${"TRUST"}, ${movement.observedAt}, ${event.received_at})
      on conflict (run_id) do update set
        point = excluded.point, quality = excluded.quality, source = excluded.source,
        observed_at = excluded.observed_at, received_at = excluded.received_at
      where excluded.observed_at >= train_positions.observed_at`);
  }

  const last = events[events.length - 1];
  await db.execute(sql`
    insert into projection_state (name, last_received_at, last_event_id, updated_at)
    values (${CURSOR}, ${last.received_at}, ${last.id}, now())
    on conflict (name) do update set
      last_received_at = excluded.last_received_at, last_event_id = excluded.last_event_id, updated_at = now()`);
  return events.length === PAGE;
}

async function main() {
  const root = new URL("../../../", import.meta.url);
  try { loadEnvFile(fileURLToPath(new URL(".env", root))); } catch { /* el entorno puede traerlo */ }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) { console.info(JSON.stringify({status: "configuration-missing"})); process.exitCode = 1; return; }

  const {db, close} = createDatabase(connectionString);
  try {
    if (process.argv.includes("--reset")) {
      await db.execute(sql`delete from projection_state where name = ${CURSOR}`);
      console.info(JSON.stringify({step: "reset", cursor: CURSOR}));
    }
    const totals: Totals = {read: 0, projected: 0, skipped: 0, positions: 0, unresolved: 0};
    while (await projectPage(db, totals)) { /* siguiente página */ }
    const state = await db.execute(sql`
      select (select count(*)::int from service_runs) as runs,
             (select count(*)::int from train_positions) as positions,
             (select count(*)::int from train_positions where quality = 'reported') as reported,
             (select count(*)::int from train_positions where quality = 'unknown') as unknown`);
    console.info(JSON.stringify({step: "done", ...totals, state: state.rows[0]}));
  } finally {
    await close();
  }
}

main().catch(error => {
  console.error(JSON.stringify({status: "projection-failed", detail: error instanceof Error ? error.message : "unknown"}));
  process.exitCode = 1;
});
