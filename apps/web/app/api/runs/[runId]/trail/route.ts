import { sql } from "drizzle-orm";
import type { Trail, TrailPoint } from "@rails/domain";
import { database } from "@/lib/database";

const MAX_POINTS = 400;

/**
 * Reconstruye por dónde ha pasado una circulación a partir de `raw_events`.
 *
 * `train_positions` guarda solo la posición actual, así que el recorrido no
 * está proyectado: se deriva de los eventos originales, que la retención
 * conserva durante la ventana configurada.
 */
export async function GET(_request: Request, {params}: {params: Promise<{runId: string}>}) {
  const {runId} = await params;
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return Response.json({error: "invalid-run"}, {status: 400});

  const result = await database().execute(sql`
    with run as (select provider_run_id, service_date from service_runs where id = ${runId})
    select to_char(e.observed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "observedAt",
           lpad(e.payload->'body'->>'loc_stanox', 5, '0') as stanox,
           l.name,
           case when l.point is null then null
                else json_build_array(ST_X(l.point), ST_Y(l.point)) end as coordinate,
           e.payload->'body'->>'event_type' as "eventType"
    from raw_events e
    join run on run.provider_run_id = e.payload->'body'->>'train_id'
    -- Una misma ubicación puede resolver a varios puntos; en ese caso no se elige.
    left join lateral (
      select min(point) as point, min(name) as name
      from locations
      where stanox = lpad(e.payload->'body'->>'loc_stanox', 5, '0') and point is not null
      having count(distinct point) = 1
    ) l on true
    where e.payload->'header'->>'msg_type' = '0003'
      and e.observed_at is not null
    order by e.observed_at, e.received_at
    limit ${MAX_POINTS}`);

  const points = result.rows as unknown as TrailPoint[];
  const trail: Trail = {
    runId, points,
    reported: points.length,
    withCoordinate: points.filter(point => point.coordinate).length
  };
  return Response.json(trail, {headers: {"cache-control": "no-store"}});
}
