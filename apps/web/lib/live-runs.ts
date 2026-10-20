import "server-only";
import { sql } from "drizzle-orm";
import type { LiveRun } from "@rails/domain";
import { database } from "./database";

/**
 * Las circulaciones con su última posición. `since` devuelve solo lo que haya
 * cambiado después de esa versión, que es el cursor reanudable del SSE.
 */
export async function liveRuns(since = 0, limit = 5000): Promise<LiveRun[]> {
  const result = await database().execute(sql`
    select p.run_id as "runId", r.provider_run_id as "providerRunId",
           to_char(r.service_date, 'YYYY-MM-DD') as "serviceDate",
           r.status, r.delay_seconds as "delaySeconds", r.toc_id as "tocId", p.quality,
           case when p.point is null then null
                else json_build_array(ST_X(p.point), ST_Y(p.point)) end as coordinate,
           to_char(p.observed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "observedAt",
           p.version::int as version
    from train_positions p
    join service_runs r on r.id = p.run_id
    where p.version > ${since}
    order by p.version
    limit ${limit}`);
  return result.rows as unknown as LiveRun[];
}

export function latestVersion(runs: LiveRun[], fallback: number): number {
  return runs.length ? runs[runs.length - 1].version : fallback;
}
