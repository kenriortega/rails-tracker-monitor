import { sql } from "drizzle-orm";
import { database } from "@/lib/database";

/** Estaciones con coordenada, para la capa de contexto del mapa. */
export async function GET() {
  const result = await database().execute(sql`
    select tiploc, coalesce(crs, '') as crs, name,
           ST_X(point) as lon, ST_Y(point) as lat
    from locations where point is not null order by name`);
  return Response.json({stations: result.rows}, {headers: {"cache-control": "public, max-age=3600"}});
}
