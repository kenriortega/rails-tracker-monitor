import "server-only";
import { sql } from "drizzle-orm";
import { ACTIVATED_GRACE_SECONDS, ACTIVATED_LEAD_SECONDS, SERVE_SECONDS, type LiveRun } from "@rails/domain";
import { database } from "./database";

/**
 * Las circulaciones con su última posición. `since` devuelve solo lo que haya
 * cambiado después de esa versión, que es el cursor reanudable del SSE.
 */
export async function liveRuns(since = 0, limit = 5000): Promise<LiveRun[]> {
  const result = await database().execute(sql`
    select p.run_id as "runId", r.provider_run_id as "providerRunId",
           to_char(r.service_date, 'YYYY-MM-DD') as "serviceDate",
           r.headcode, r.status, r.delay_seconds as "delaySeconds", r.toc_id as "tocId", p.quality,
           to_char(r.scheduled_departure at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "scheduledDeparture",
           coalesce(lo.name, ends.origin_tiploc) as origin,
           coalesce(ld.name, ends.destination_tiploc) as destination,
           case when p.point is null then null
                else json_build_array(ST_X(p.point), ST_Y(p.point)) end as coordinate,
           to_char(p.observed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "observedAt",
           p.version::int as version
    from train_positions p
    join service_runs r on r.id = p.run_id
    -- El horario solo está enlazado cuando se capturó la activación del tren.
    left join schedules sc on sc.id = r.schedule_id
    left join lateral (
      select sc.payload->'schedule_segment'->'schedule_location'->0->>'tiploc_code' as origin_tiploc,
             sc.payload->'schedule_segment'->'schedule_location'->-1->>'tiploc_code' as destination_tiploc
    ) ends on true
    left join locations lo on lo.tiploc = ends.origin_tiploc
    left join locations ld on ld.tiploc = ends.destination_tiploc
    where p.version > ${since}
      -- Fuera de la ventana no se sirve: la vista acumulaba circulaciones que
      -- dejaron de reportar hace horas. El cliente también las caduca por su
      -- cuenta, porque envejecer no genera una versión nueva que empujar.
      --
      -- Un tren activado no tiene reportes que envejecer, así que su ventana se
      -- ancla a la salida prevista del origen en lugar de a la activación.
      and (
        case when r.status = 'activated' and r.scheduled_departure is not null
          then r.scheduled_departure between now() - make_interval(secs => ${ACTIVATED_GRACE_SECONDS})
                                         and now() + make_interval(secs => ${ACTIVATED_LEAD_SECONDS})
          else p.observed_at > now() - make_interval(secs => ${SERVE_SECONDS})
        end
      )
    order by p.version
    limit ${limit}`);
  return result.rows as unknown as LiveRun[];
}

export function latestVersion(runs: LiveRun[], fallback: number): number {
  return runs.length ? runs[runs.length - 1].version : fallback;
}
