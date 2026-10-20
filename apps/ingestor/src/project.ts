import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { createDatabase } from "@rails/db";
import { MOVEMENT_FEED } from "./records";
import { PROVIDER, projectActivation, projectMovement } from "./projection";

const CURSOR = "movement";
const PAGE = 1000;

type Database = ReturnType<typeof createDatabase>["db"];

interface Totals { read: number; projected: number; activations: number; skipped: number; positions: number; unresolved: number }

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

    const activation = projectActivation(event.payload, event.received_at);
    if (activation) {
      totals.activations++;
      /**
       * Una activación no debe degradar a un tren que ya circula: si la
       * circulación existe, solo se completan los datos que falten y el estado
       * se deja como está.
       */
      const run = await db.execute(sql`
        insert into service_runs (provider, provider_run_id, service_date, status, toc_id, headcode, scheduled_departure)
        values (${PROVIDER}, ${activation.providerRunId}, ${activation.serviceDate}, ${"activated"}, ${activation.tocId}, ${activation.headcode}, ${activation.scheduledDeparture})
        on conflict (provider, service_date, provider_run_id) do update set
          toc_id = coalesce(service_runs.toc_id, excluded.toc_id),
          headcode = coalesce(service_runs.headcode, excluded.headcode),
          scheduled_departure = coalesce(excluded.scheduled_departure, service_runs.scheduled_departure)
        returning id`);
      // Marcador sin coordenada: el tren se conoce, su posición todavía no.
      await db.execute(sql`
        insert into train_positions (run_id, point, quality, source, observed_at, received_at)
        values (${(run.rows[0] as {id: string}).id}, null, ${"unknown"}, ${"TRUST"}, ${activation.observedAt}, ${event.received_at})
        on conflict (run_id) do nothing`);
      continue;
    }

    const movement = projectMovement(event.payload, event.received_at);
    if (!movement) { totals.skipped++; continue; }
    totals.projected++;

    const run = await db.execute(sql`
      insert into service_runs (provider, provider_run_id, service_date, status, delay_seconds, toc_id, headcode)
      values (${PROVIDER}, ${movement.providerRunId}, ${movement.serviceDate}, ${movement.status}, ${movement.delaySeconds}, ${movement.tocId}, ${movement.headcode})
      on conflict (provider, service_date, provider_run_id) do update set
        status = excluded.status, delay_seconds = coalesce(excluded.delay_seconds, service_runs.delay_seconds),
        toc_id = coalesce(excluded.toc_id, service_runs.toc_id),
        headcode = coalesce(excluded.headcode, service_runs.headcode)
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

/**
 * Enlaza circulaciones con su horario a través de la activación `0001`, que es
 * el único mensaje que trae `train_uid`. Los movimientos no lo llevan, así que
 * sin haber capturado la activación del tren no hay enlace posible.
 *
 * La unión es por `train_uid` y fecha de inicio, **sin** el indicador STP. El
 * campo `schedule_type` de la activación no es ese indicador: sobre 63
 * activaciones reales decía `O` donde el horario de esa fecha era `P`, y al
 * revés. Por uid y fecha coincidieron 53 de 63 sin una sola ambigüedad, así que
 * la clave basta y no hace falta interpretar un campo cuyo significado no está
 * verificado.
 */
async function linkSchedules(db: Database) {
  const linked = await db.execute(sql`
    update service_runs r set schedule_id = s.id
    from raw_events e
    join schedules s
      on s.uid = e.payload->'body'->>'train_uid'
     and s.valid_from = (e.payload->'body'->>'schedule_start_date')::date
    where e.payload->'header'->>'msg_type' = '0001'
      and r.provider_run_id = e.payload->'body'->>'train_id'
      and r.schedule_id is null
    returning r.id`);
  const coverage = await db.execute(sql`
    select count(*)::int as runs, count(schedule_id)::int as withSchedule from service_runs`);
  return {linkedNow: linked.rows.length, ...(coverage.rows[0] as Record<string, number>)};
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
    // Con --loop la proyección acompaña a la ingesta continua; sin él procesa
    // lo pendiente y termina, que es lo que necesitan las verificaciones.
    const loopArg = process.argv.find(arg => arg.startsWith("--loop"));
    const everySeconds = loopArg ? Number(loopArg.split("=")[1] ?? 30) : null;
    if (everySeconds !== null && (!Number.isFinite(everySeconds) || everySeconds < 5)) {
      console.info(JSON.stringify({status: "invalid-loop", minimumSeconds: 5})); process.exitCode = 1; return;
    }

    let stopping = false;
    const stop = () => { stopping = true; };
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, stop);

    do {
      const totals: Totals = {read: 0, projected: 0, activations: 0, skipped: 0, positions: 0, unresolved: 0};
      while (await projectPage(db, totals)) { /* siguiente página */ }
      const schedules = await linkSchedules(db);
      const state = await db.execute(sql`
        select (select count(*)::int from service_runs) as runs,
               (select count(*)::int from train_positions) as positions,
               (select count(*)::int from train_positions where quality = 'reported') as reported,
               (select count(*)::int from train_positions where quality = 'unknown') as unknown,
               (select count(*)::int from service_runs where status = 'activated') as activated`);
      console.info(JSON.stringify({at: new Date().toISOString(), step: "done", ...totals, state: state.rows[0], schedules}));
      if (everySeconds === null || stopping) break;
      await new Promise(resolve => setTimeout(resolve, everySeconds * 1000));
    } while (!stopping);
  } finally {
    await close();
  }
}

main().catch(error => {
  console.error(JSON.stringify({status: "projection-failed", detail: error instanceof Error ? error.message : "unknown"}));
  process.exitCode = 1;
});
