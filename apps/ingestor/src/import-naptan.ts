import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { createDatabase } from "@rails/db";
import { corpusRecords } from "./diagnostics/audit";
import { fetchFeed, readJson } from "./diagnostics/http";
import { parseRailStations, type RailStation } from "./naptan";

const BATCH = 500;

/** CORPUS aporta el STANOX, que NaPTAN no publica. Sin credenciales se omite. */
async function stanoxByTiploc(): Promise<Map<string, string>> {
  const username = process.env.NETWORK_RAIL_USERNAME, password = process.env.NETWORK_RAIL_PASSWORD;
  const map = new Map<string, string>();
  if (!username?.trim() || !password) return map;
  const corpus = corpusRecords(await readJson(await fetchFeed("/ntrod/SupportingFileAuthenticate?type=CORPUS", {username, password})));
  for (const entry of corpus as unknown as Record<string, string>[]) {
    const tiploc = String(entry.TIPLOC ?? "").trim().toUpperCase();
    const stanox = String(entry.STANOX ?? "").trim();
    if (tiploc && /^\d{1,5}$/.test(stanox) && Number(stanox) > 0) map.set(tiploc, stanox.padStart(5, "0"));
  }
  return map;
}

async function main() {
  const root = new URL("../../../", import.meta.url);
  try { loadEnvFile(fileURLToPath(new URL(".env", root))); } catch { /* el entorno puede traerlo */ }

  const file = process.argv.find(arg => arg.startsWith("--file="))?.slice(7);
  const connectionString = process.env.DATABASE_URL;
  if (!file || !connectionString) {
    console.info(JSON.stringify({status: "usage", need: "--file=<naptan.xml> y DATABASE_URL"}));
    process.exitCode = 1; return;
  }

  const stanox = await stanoxByTiploc();
  console.info(JSON.stringify({step: "corpus", tiplocsWithStanox: stanox.size}));

  // El XML pesa cientos de MB, pero las estaciones extraídas son unos pocos miles.
  const stations: RailStation[] = [];
  const totals = await parseRailStations(file, station => stations.push(station));
  console.info(JSON.stringify({step: "parse", ...totals}));

  const {db, close} = createDatabase(connectionString);
  try {
    let written = 0;
    for (let start = 0; start < stations.length; start += BATCH) {
      const batch = stations.slice(start, start + BATCH);
      /**
       * Drizzle serializa la geometría como `point(x y)`, sin SRID, y la restricción
       * location_point_wgs84 lo rechazaría. El punto se escribe con SQL explícito.
       */
      const values = batch.map(s => sql`(${s.name}, ${s.tiploc}, ${stanox.get(s.tiploc) ?? null}, ${s.crs}, ST_SetSRID(ST_MakePoint(${s.longitude}, ${s.latitude}), 4326))`);
      await db.execute(sql`
        insert into locations (name, tiploc, stanox, crs, point)
        values ${sql.join(values, sql`, `)}
        on conflict (tiploc) do update set
          name = excluded.name, stanox = excluded.stanox, crs = excluded.crs, point = excluded.point`);
      written += batch.length;
    }
    const counted = await db.execute(sql`
      select count(*)::int as total, count(point)::int as with_point,
             count(*) filter (where stanox is not null)::int as with_stanox
      from locations`);
    console.info(JSON.stringify({step: "done", written, locations: counted.rows[0]}));
  } finally {
    await close();
  }
}

main().catch(error => {
  console.error(JSON.stringify({status: "import-failed", detail: error instanceof Error ? error.message : "unknown"}));
  process.exitCode = 1;
});
