import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { sql } from "drizzle-orm";
import { londonServiceDate } from "@rails/domain";
import { createDatabase } from "@rails/db";
import { decodedChunks, fetchFeed } from "./diagnostics/http";
import { readSchedules, type ScheduleRecord } from "./schedule";

const FEED = "/ntrod/CifFileAuthenticate?type=CIF_ALL_FULL_DAILY&day=toc-full";
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;
const BATCH = 500;
// El horario nacional comprimido ronda los cientos de megabytes.
const DOWNLOAD_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;

async function* localChunks(path: string): AsyncGenerator<Buffer> {
  const stream = path.endsWith(".gz") ? createReadStream(path).pipe(createGunzip()) : createReadStream(path);
  for await (const chunk of stream) yield chunk as Buffer;
}

async function main() {
  const root = new URL("../../../", import.meta.url);
  try { loadEnvFile(fileURLToPath(new URL(".env", root))); } catch { /* el entorno puede traerlo */ }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) { console.info(JSON.stringify({status: "configuration-missing"})); process.exitCode = 1; return; }

  const file = process.argv.find(arg => arg.startsWith("--file="))?.slice(7);
  const date = process.argv.find(arg => arg.startsWith("--date="))?.slice(7) ?? londonServiceDate(Date.now());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { console.info(JSON.stringify({status: "invalid-date"})); process.exitCode = 1; return; }

  let chunks: AsyncIterable<Buffer>;
  if (file) {
    chunks = localChunks(file);
  } else {
    const username = process.env.NETWORK_RAIL_USERNAME, password = process.env.NETWORK_RAIL_PASSWORD;
    if (!username?.trim() || !password) { console.info(JSON.stringify({status: "credentials-missing"})); process.exitCode = 1; return; }
    const response = await fetchFeed(FEED, {username, password}, fetch, DOWNLOAD_TIMEOUT_MS);
    if (!response.ok) { console.info(JSON.stringify({status: "http-rejected", httpStatus: response.status})); process.exitCode = 1; return; }
    chunks = decodedChunks(response, DOWNLOAD_LIMIT_BYTES);
  }
  console.info(JSON.stringify({step: "start", coveringDate: date, source: file ? "file" : "feed"}));

  const {db, close} = createDatabase(connectionString);
  let pending: ScheduleRecord[] = [];
  let written = 0;

  async function flush() {
    if (!pending.length) return;
    const values = pending.map(r => sql`(${r.uid}, ${r.validFrom}, ${r.validTo}, ${r.stpIndicator}, ${JSON.stringify(r.payload)}::jsonb)`);
    await db.execute(sql`
      insert into schedules (uid, valid_from, valid_to, stp_indicator, payload)
      values ${sql.join(values, sql`, `)}
      on conflict (uid, valid_from, stp_indicator) do update set
        valid_to = excluded.valid_to, payload = excluded.payload`);
    written += pending.length;
    pending = [];
  }

  try {
    const totals = await readSchedules(chunks, date, async record => {
      pending.push(record);
      if (pending.length >= BATCH) await flush();
    });
    await flush();
    const counted = await db.execute(sql`
      select count(*)::int as total, pg_total_relation_size('schedules') as bytes from schedules`);
    console.info(JSON.stringify({step: "done", ...totals, written, schedules: counted.rows[0]}));
  } finally {
    await close();
  }
}

main().catch(error => {
  console.error(JSON.stringify({status: "import-failed", detail: error instanceof Error ? error.message : "unknown"}));
  process.exitCode = 1;
});
