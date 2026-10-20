import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { createDatabase } from "@rails/db";

const CURSOR = "movement";
const DEFAULT_DAYS = 7;
const BATCH = 5000;

/**
 * Poda de `raw_events` y de las proyecciones que ya no se sirven.
 *
 * El coste de esta política es explícito: **más allá de la ventana no se puede
 * reproyectar**. Esa capacidad es la que permite corregir la lógica y rehacer el
 * estado, así que la ventana no debería acortarse sin motivo.
 */
async function main() {
  const root = new URL("../../../", import.meta.url);
  try { loadEnvFile(fileURLToPath(new URL(".env", root))); } catch { /* el entorno puede traerlo */ }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) { console.info(JSON.stringify({status: "configuration-missing"})); process.exitCode = 1; return; }

  const daysArg = process.argv.find(arg => arg.startsWith("--days="))?.slice(7);
  const days = daysArg ? Number(daysArg) : DEFAULT_DAYS;
  if (!Number.isFinite(days) || days < 1) {
    console.info(JSON.stringify({status: "invalid-days", minimum: 1})); process.exitCode = 1; return;
  }
  const dryRun = process.argv.includes("--dry-run");

  const {db, close} = createDatabase(connectionString);
  try {
    const before = await db.execute(sql`
      select (select count(*)::int from raw_events) as events,
             pg_total_relation_size('raw_events') as bytes,
             (select count(*)::int from raw_events where received_at < now() - make_interval(days => ${days})) as expired`);
    const cursor = await db.execute(sql`select last_received_at from projection_state where name = ${CURSOR}`);
    const projectedUpTo = (cursor.rows[0] as {last_received_at: Date} | undefined)?.last_received_at ?? null;

    // Nunca borrar por delante de la proyección: si va retrasada o detenida, es
    // preferible no podar que perder eventos sin proyectar.
    if (!projectedUpTo) {
      console.info(JSON.stringify({status: "blocked", reason: "projection-cursor-missing", ...before.rows[0]}));
      process.exitCode = 1; return;
    }

    const guard = await db.execute(sql`
      select count(*)::int as deletable from raw_events
      where received_at < now() - make_interval(days => ${days}) and received_at <= ${projectedUpTo}`);
    const deletable = (guard.rows[0] as {deletable: number}).deletable;
    const held = (before.rows[0] as {expired: number}).expired - deletable;

    if (dryRun) {
      console.info(JSON.stringify({status: "dry-run", projectedUpTo, ...before.rows[0], deletable, heldByCursor: held}));
      return;
    }

    let deleted = 0;
    for (;;) {
      const batch = await db.execute(sql`
        delete from raw_events where id in (
          select id from raw_events
          where received_at < now() - make_interval(days => ${days}) and received_at <= ${projectedUpTo}
          order by received_at limit ${BATCH})
        returning id`);
      if (!batch.rows.length) break;
      deleted += batch.rows.length;
    }

    // Las proyecciones sin reporte dentro de la ventana ya no se sirven.
    const positions = await db.execute(sql`
      delete from train_positions where observed_at < now() - make_interval(days => ${days}) returning run_id`);
    const runs = await db.execute(sql`
      delete from service_runs r where not exists (select 1 from train_positions p where p.run_id = r.id) returning r.id`);

    const after = await db.execute(sql`
      select (select count(*)::int from raw_events) as events, pg_total_relation_size('raw_events') as bytes`);
    console.info(JSON.stringify({
      status: "pruned", days, projectedUpTo, heldByCursor: held,
      deletedEvents: deleted, deletedPositions: positions.rows.length, deletedRuns: runs.rows.length,
      before: before.rows[0], after: after.rows[0]
    }));
  } finally {
    await close();
  }
}

main().catch(error => {
  console.error(JSON.stringify({status: "prune-failed", detail: error instanceof Error ? error.message : "unknown"}));
  process.exitCode = 1;
});
