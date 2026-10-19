import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { corpusRecords, type CorpusEntry } from "./diagnostics/audit";
import { fetchFeed, readJson, readScheduleSample, safeErrorCode } from "./diagnostics/http";
import { checkMovement } from "./diagnostics/stomp";

async function main() {
  const root = new URL("../../../", import.meta.url);
  try { loadEnvFile(fileURLToPath(new URL(".env", root))); }
  catch { console.info(JSON.stringify({step: "environment", status: "env-file-unavailable"})); process.exitCode = 1; return; }
  const username = process.env.NETWORK_RAIL_USERNAME;
  const password = process.env.NETWORK_RAIL_PASSWORD;
  if (!username?.trim() || !password) {
    console.info(JSON.stringify({step: "environment", status: "credentials-missing", usernamePresent: Boolean(username?.trim()), passwordPresent: Boolean(password)}));
    process.exitCode = 1; return;
  }
  const durationArg = process.argv.find(arg => arg.startsWith("--seconds="));
  const seconds = durationArg ? Number(durationArg.slice(10)) : 45;
  if (!Number.isInteger(seconds) || seconds < 10 || seconds > 120) {
    console.info(JSON.stringify({status: "invalid-duration", allowedSeconds: "10–120"})); process.exitCode = 1; return;
  }
  const credentials = {username, password};
  console.info(JSON.stringify({step: "environment", status: "credentials-loaded", valuesRedacted: true}));
  const report: Record<string, unknown> = {
    checkedAt: new Date().toISOString(), mode: "bounded-read-only-diagnostic",
    rawPayloadsSaved: false, credentialsLogged: false, geographicPositionsVerified: false
  };
  let corpus: CorpusEntry[] | null = null;
  try {
    const response = await fetchFeed("/ntrod/SupportingFileAuthenticate?type=CORPUS", credentials);
    if (!response.ok) {
      report.corpus = {status: "http-rejected", httpStatus: response.status};
      await response.body?.cancel();
    } else {
      corpus = corpusRecords(await readJson(response));
      report.corpus = {status: "valid", records: corpus.length, recordsWithStanox: corpus.filter(entry => String(entry.STANOX ?? "").trim()).length};
    }
  } catch (error) { report.corpus = {status: "failed", error: safeErrorCode(error)}; }
  console.info(JSON.stringify({step: "corpus", result: report.corpus}));

  try {
    const response = await fetchFeed("/ntrod/CifFileAuthenticate?type=CIF_ALL_FULL_DAILY&day=toc-full", credentials);
    if (!response.ok) {
      report.schedule = {status: "http-rejected", httpStatus: response.status};
      await response.body?.cancel();
    } else report.schedule = {status: "sample-valid", ...await readScheduleSample(response)};
  } catch (error) { report.schedule = {status: "failed", error: safeErrorCode(error)}; }
  console.info(JSON.stringify({step: "schedule", result: report.schedule}));

  report.movement = await checkMovement(credentials, corpus, seconds);
  console.info(JSON.stringify({step: "movement", result: report.movement}));
  await writeFile(new URL("docs/network-rail-diagnostic.json", root), JSON.stringify(report, null, 2) + "\n", {mode: 0o600});
  console.info(JSON.stringify({step: "report", path: "docs/network-rail-diagnostic.json", containsSecrets: false}));
  const movement = report.movement as {status: string; invalidJsonBatches: number; invalidRecords: number};
  if (!corpus || (report.schedule as {status: string}).status !== "sample-valid" || movement.status !== "received" || movement.invalidJsonBatches || movement.invalidRecords) process.exitCode = 1;
}

main().catch(() => {
  console.error(JSON.stringify({status: "diagnostic-failed", detail: "Unexpected error; details suppressed to protect credentials."}));
  process.exitCode = 1;
});
